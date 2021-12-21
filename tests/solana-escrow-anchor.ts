import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { SolanaEscrowAnchor } from '../target/types/solana_escrow_anchor';
import { Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import {
    getKeypair,
    getPublicKey,
    getTokenBalance,
    writePublicKey,
} from "./utils";
import {Keypair, LAMPORTS_PER_SOL, PublicKey, Signer} from "@solana/web3.js";

describe('solana-escrow-anchor', () => {

    // Configure the client to use the local cluster.
    const provider = anchor.Provider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.SolanaEscrowAnchor as Program<SolanaEscrowAnchor>;

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

    })
});
