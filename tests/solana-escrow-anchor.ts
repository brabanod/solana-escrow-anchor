import * as anchor from '@project-serum/anchor';
import {BN, Program} from '@project-serum/anchor';
import { SolanaEscrowAnchor } from '../target/types/solana_escrow_anchor';
import {AccountLayout, Token, TOKEN_PROGRAM_ID} from "@solana/spl-token";

import {
    getKeypair, getProgramId,
    getPublicKey, getTerms,
    getTokenBalance,
    writePublicKey,
} from "./utils";
import {Keypair, LAMPORTS_PER_SOL, PublicKey, Signer, SystemProgram} from "@solana/web3.js";
import * as assert from "assert";

describe('solana-escrow-anchor', () => {

    // Configure the client to use the local cluster.
    const provider = anchor.Provider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.SolanaEscrowAnchor as Program<SolanaEscrowAnchor>;

    const ESCROW_PDA_SEED = "escrow";

    it('Setup', async () => {
        const createMint = (payer: Signer): Promise<Token> => {
            return Token.createMint(
                provider.connection,
                payer,
                payer.publicKey,
                null,
                0,
                TOKEN_PROGRAM_ID
            );
        }

        const setupMint = async (
            name: string,
            alicePublicKey: PublicKey,
            bobPublicKey: PublicKey,
            clientKeypair: Signer,
        ): Promise<[Token, PublicKey, PublicKey]> => {
            console.log(`Creating Mint ${name} ...`);
            const mint = await createMint(clientKeypair)
            writePublicKey(mint.publicKey, `mint_${name.toLowerCase()}`);

            console.log(`Creating Alice TokenAccount for ${name}...`);
            const aliceTokenAccount = await mint.createAccount(alicePublicKey);
            writePublicKey(aliceTokenAccount, `alice_${name.toLowerCase()}`);

            console.log(`Creating Bob TokenAccount for ${name}...`);
            const bobTokenAccount = await mint.createAccount(bobPublicKey);
            writePublicKey(bobTokenAccount, `bob_${name.toLowerCase()}`);

            return [mint, aliceTokenAccount, bobTokenAccount];
        }

        const alicePublicKey = getPublicKey("alice");
        const bobPublicKey = getPublicKey("bob");
        const clientKeypair = getKeypair("id");

        // Airdrop SOL
        console.log("Requesting SOL for Alice...");
        const airdropAlice = await provider.connection.requestAirdrop(alicePublicKey, LAMPORTS_PER_SOL * 10);
        console.log("Requesting SOL for Bob...");
        const airdropBob = await provider.connection.requestAirdrop(bobPublicKey, LAMPORTS_PER_SOL * 10);
        console.log("Requesting SOL for Client...");
        const airdropClient = await provider.connection.requestAirdrop(clientKeypair.publicKey, LAMPORTS_PER_SOL * 10);

        await provider.connection.confirmTransaction(airdropAlice, "processed");
        await provider.connection.confirmTransaction(airdropBob, "processed");
        await provider.connection.confirmTransaction(airdropClient, "processed");

        const [mintX, aliceTokenAccountForX, bobTokenAccountForX] = await setupMint(
            "X",
            alicePublicKey,
            bobPublicKey,
            clientKeypair,
        );
        console.log("Sending 50X to Alice's X TokenAccount ...");
        await mintX.mintTo(aliceTokenAccountForX, clientKeypair.publicKey, [], 50);

        const [mintY, aliceTokenAccountForY, bobTokenAccountForY] = await setupMint(
            "Y",
            alicePublicKey,
            bobPublicKey,
            clientKeypair,
        );
        console.log("Sending 50Y to Bob's X TokenAccount ...");
        await mintY.mintTo(bobTokenAccountForY, clientKeypair.publicKey, [], 50);

        console.log("✨Setup complete✨\n");
        console.table([
            {
                "Alice Token Account X": await getTokenBalance(
                    aliceTokenAccountForX,
                    provider.connection
                ),
                "Alice Token Account Y": await getTokenBalance(
                    aliceTokenAccountForY,
                    provider.connection
                ),
                "Bob Token Account X": await getTokenBalance(
                    bobTokenAccountForX,
                    provider.connection
                ),
                "Bob Token Account Y": await getTokenBalance(
                    bobTokenAccountForY,
                    provider.connection
                ),
            },
        ]);
        console.log("");
    });

    it("Alice", async () => {
        const terms = getTerms();

        const aliceXTokenAccountPubkey = getPublicKey("alice_x");
        const aliceYTokenAccountPubkey = getPublicKey("alice_y");
        const XTokenMintPubkey = getPublicKey("mint_x");
        const aliceKeypair = getKeypair("alice");

        // Init
        const tempXTokenAccountKeypair = new Keypair();
        const escrowKeypair = new Keypair();

        console.log("Creating temp token Account")
        const createTempTokenAccountIx = SystemProgram.createAccount({
            programId: TOKEN_PROGRAM_ID,
            space: AccountLayout.span,
            lamports: await provider.connection.getMinimumBalanceForRentExemption(AccountLayout.span),
            fromPubkey: aliceKeypair.publicKey,
            newAccountPubkey: tempXTokenAccountKeypair.publicKey,
        });
        const initTempAccountIx = Token.createInitAccountInstruction(
            TOKEN_PROGRAM_ID,
            XTokenMintPubkey,
            tempXTokenAccountKeypair.publicKey,
            aliceKeypair.publicKey
        );
        const transferXTokensToTempAccIx = Token.createTransferInstruction(
            TOKEN_PROGRAM_ID,
            aliceXTokenAccountPubkey,
            tempXTokenAccountKeypair.publicKey,
            aliceKeypair.publicKey,
            [],
            terms.bobExpectedAmount
        );
        const tx = new anchor.web3.Transaction().add(
            createTempTokenAccountIx,
            initTempAccountIx,
            transferXTokensToTempAccIx,
        );
        const txSig = await provider.connection.sendTransaction(
            tx,
            [aliceKeypair, tempXTokenAccountKeypair],
            {skipPreflight: false, preflightCommitment: "confirmed"}
        );
        await provider.connection.confirmTransaction(txSig);

        console.log("Sending Alice's transaction...");
        let initTx = await program.rpc.initialize(
            new anchor.BN(terms.aliceExpectedAmount),
            {
                accounts: {
                    initializer: aliceKeypair.publicKey,
                    tempTokenAccount: tempXTokenAccountKeypair.publicKey,
                    tokenToReceiveAccount: aliceYTokenAccountPubkey,
                    escrowAccount: escrowKeypair.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: anchor.web3.SystemProgram.programId,
                },
                signers: [aliceKeypair, escrowKeypair],
            }
        );
        await provider.connection.confirmTransaction(initTx, "confirmed");

        const escrow = await program.account.escrow.fetch(escrowKeypair.publicKey);

        assert.equal(
            escrow.isInitialized,
            true,
            "Escrow state initialization flag has not been set");
        assert.equal(
            escrow.initializerPubkey.toBase58(),
            aliceKeypair.publicKey.toBase58(),
            "InitializerPubkey has not been set correctly / not been set to Alice's public key");
        assert.equal(
            escrow.initializerTokenToReceiveAccountPubkey.toBase58(),
            aliceYTokenAccountPubkey.toBase58(),
            "initializerTokenToReceiveAccountPubkey has not been set correctly / not been set to Alice's Y public key");
        assert.equal(
            escrow.tempTokenAccountPubkey.toBase58(),
            tempXTokenAccountKeypair.publicKey.toBase58(),
            "tempXTokenAccountKeypair has not been set correctly / not been set to temp X token account public key");

        // Persist escrow key
        writePublicKey(escrowKeypair.publicKey, "escrow");

        console.table([
            {
                "Alice Token Account X": await getTokenBalance(
                    aliceXTokenAccountPubkey,
                    provider.connection
                ),
                "Alice Token Account Y": await getTokenBalance(
                    aliceYTokenAccountPubkey,
                    provider.connection
                ),
                "Bob Token Account X": await getTokenBalance(
                    getPublicKey("bob_x"),
                    provider.connection
                ),
                "Bob Token Account Y": await getTokenBalance(
                    getPublicKey("bob_y"),
                    provider.connection
                ),
                "Temporary Token Account X": await getTokenBalance(
                    tempXTokenAccountKeypair.publicKey,
                    provider.connection
                ),
            },
        ]);
        console.log("");
    });

    it("Bob", async () => {
        const bobKeypair = getKeypair("bob");
        const bobXTokenAccountPubkey = getPublicKey("bob_x");
        const bobYTokenAccountPubkey = getPublicKey("bob_y");
        const escrowStateAccountPubkey = getPublicKey("escrow");
        const escrowProgramId = getProgramId();
        const terms = getTerms();

        const escrow = await program.account.escrow.fetch(escrowStateAccountPubkey);
        assert.ok(escrow, "Could not find escrow at given address!");

        const PDA = await PublicKey.findProgramAddress(
            [Buffer.from(ESCROW_PDA_SEED)],
            escrowProgramId,
        );

        const aliceYTokenAccountPubkey = getPublicKey("alice_y");
        const [aliceYbalance, bobXbalance] = await Promise.all([
            getTokenBalance(aliceYTokenAccountPubkey, provider.connection),
            getTokenBalance(bobXTokenAccountPubkey, provider.connection),
        ]);

        console.log("Sending Bob's transaction...");
        const exchangeTx = await program.rpc.exchange(
            new anchor.BN(terms.bobExpectedAmount),
            {
                accounts: {
                    taker: bobKeypair.publicKey,
                    takersSendingTokenAccount: bobYTokenAccountPubkey,
                    takersTokenToReceiveAccount: bobXTokenAccountPubkey,
                    pdasTempTokenAccount: escrow.tempTokenAccountPubkey,
                    initializersMainAccount: escrow.initializerPubkey,
                    initializersTokenToReceiveAccount: escrow.initializerTokenToReceiveAccountPubkey,
                    escrowAccount: escrowStateAccountPubkey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    pdaAccount: PDA[0],
                },
                signers: [bobKeypair],
            }
        );
        await provider.connection.confirmTransaction(exchangeTx, "confirmed");

        assert.equal(
            await provider.connection.getAccountInfo(escrowStateAccountPubkey),
            null,
            "Escrow account has not been closed."
        );
        assert.equal(
            await provider.connection.getAccountInfo(escrow.tempTokenAccountPubkey),
            null,
            "Temp X token account has not been closed."
        );

        const [newAliceYbalance, newBobXbalance] = await Promise.all([
            getTokenBalance(aliceYTokenAccountPubkey, provider.connection),
            getTokenBalance(bobXTokenAccountPubkey, provider.connection),
        ]);

        assert.equal(
            newAliceYbalance,
            aliceYbalance + terms.aliceExpectedAmount,
            `Alice's Y balance should be ${aliceYbalance + terms.aliceExpectedAmount} but is ${newAliceYbalance}`
        );
        assert.equal(
            newBobXbalance,
            bobXbalance + terms.bobExpectedAmount,
            `Bob's X balance should be ${bobXbalance + terms.bobExpectedAmount} but is ${newBobXbalance}`
        );

        console.log(
            "✨Trade successfully executed. All temporary accounts closed✨\n"
        );
        console.table([
            {
                "Alice Token Account X": await getTokenBalance(
                    getPublicKey("alice_x"),
                    provider.connection
                ),
                "Alice Token Account Y": newAliceYbalance,
                "Bob Token Account X": newBobXbalance,
                "Bob Token Account Y": await getTokenBalance(
                    bobYTokenAccountPubkey,
                    provider.connection
                ),
            },
        ]);
        console.log("");
    });
});
