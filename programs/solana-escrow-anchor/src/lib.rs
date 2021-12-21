use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_program;
use anchor_spl::token::{self, SetAuthority, TokenAccount};

declare_id!("ECh7FQHy1hDxkiYjPVi8tYhmZ2oHE1zJqsyxbP4vS3nd");

#[program]
pub mod anchor_escrow {
    use spl_token::instruction::AuthorityType;
    use super::*;

    const ESCROW_PDA_SEED: &[u8] = b"escrow";

    pub fn initialize(ctx: Context<Initialize>, amount: u64) -> ProgramResult {
        // Store data in escrow account
        let escrow_account = &mut ctx.accounts.escrow_account;
        escrow_account.initializer_pubkey = *ctx.accounts.initializer.to_account_info().key;
        escrow_account.temp_token_account_pubkey = *ctx.accounts.temp_token_account.to_account_info().key;
        escrow_account.initializer_token_to_receive_account_pubkey = *ctx.accounts.token_to_receive_account.to_account_info().key;
        escrow_account.expected_amount = amount;

        // Create PDA, which will own the temp token account
        let (pda, _bump_seed) = Pubkey::find_program_address(&[ESCROW_PDA_SEED], ctx.program_id);
        token::set_authority(ctx.accounts.into(), AuthorityType::AccountOwner, Some(pda))?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub initializer: Signer<'info>,
    #[account(mut)]
    pub temp_token_account: Account<'info, TokenAccount>,
    #[account(
        constraint = *token_to_receive_account.to_account_info().owner == spl_token::id()
    )]
    pub token_to_receive_account: Account<'info, TokenAccount>,
    #[account(
        init, payer = initializer, space = Escrow::LEN,
        constraint = !(&Rent::get()?).is_exempt(escrow_account.to_account_info().lamports(), escrow_account.to_account_info().data_len())
    )]
    pub escrow_account: Account<'info, Escrow>,
    #[account(address = spl_token::id())]
    pub token_program: AccountInfo<'info>,
    #[account(address = system_program::ID)]
    pub system_program: AccountInfo<'info>,
}

#[account]
pub struct Escrow {
    pub initializer_pubkey: Pubkey,
    pub temp_token_account_pubkey: Pubkey,
    pub initializer_token_to_receive_account_pubkey: Pubkey,
    pub expected_amount: u64,
}

const DISCRIMINATOR_LENGTH: usize = 8;
const PUBLIC_KEY_LENGTH: usize = 32;
const U64_LENGTH: usize = 8;

impl Escrow {
    const LEN: usize = DISCRIMINATOR_LENGTH +
        PUBLIC_KEY_LENGTH * 3 +
        U64_LENGTH;
}

impl<'info> From<&mut Initialize<'info>> for CpiContext<'_, '_, '_, 'info, SetAuthority<'info>> {
    fn from(accounts: &mut Initialize<'info>) -> Self {
        let cpi_accounts = SetAuthority {
            current_authority: accounts.initializer.to_account_info().clone(),
            account_or_mint: accounts.temp_token_account.to_account_info().clone(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}