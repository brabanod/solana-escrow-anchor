use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_program;
use anchor_spl::token::{self, CloseAccount, SetAuthority, TokenAccount, Transfer};

declare_id!("ECh7FQHy1hDxkiYjPVi8tYhmZ2oHE1zJqsyxbP4vS3nd");

#[program]
pub mod solana_escrow_anchor {
    use spl_token::instruction::AuthorityType;
    use super::*;

    const ESCROW_PDA_SEED: &[u8] = b"escrow";

    pub fn initialize(ctx: Context<Initialize>, amount: u64) -> ProgramResult {
        // Store data in escrow account
        let escrow_account = &mut ctx.accounts.escrow_account;
        escrow_account.is_initialized = true;
        escrow_account.initializer_pubkey = *ctx.accounts.initializer.to_account_info().key;
        escrow_account.temp_token_account_pubkey = *ctx.accounts.temp_token_account.to_account_info().key;
        escrow_account.initializer_token_to_receive_account_pubkey = *ctx.accounts.token_to_receive_account.to_account_info().key;
        escrow_account.expected_amount = amount;

        // Create PDA, which will own the temp token account
        let (pda, _bump_seed) = Pubkey::find_program_address(&[ESCROW_PDA_SEED], ctx.program_id);
        token::set_authority(ctx.accounts.into(), AuthorityType::AccountOwner, Some(pda))?;

        Ok(())
    }

    pub fn exchange(ctx: Context<Exchange>, amount_expected_by_taker: u64) -> ProgramResult {
        let escrow_account = &ctx.accounts.escrow_account;

        // Ensure that expected and deposited amount match
        if amount_expected_by_taker != ctx.accounts.pdas_temp_token_account.amount {
            return Err(ErrorCode::ExpectedAmountMismatch.into());
        }

        // Get PDA
        let (_pda, bump_seed) = Pubkey::find_program_address(&[ESCROW_PDA_SEED], ctx.program_id);
        let seeds = &[&ESCROW_PDA_SEED[..], &[bump_seed]];

        // Transfer tokens from taker to initializer
        token::transfer(
            ctx.accounts.into_transfer_to_initializer_context(),
            escrow_account.expected_amount)?;

        // Transfer tokens from initializer to taker
        token::transfer(
            ctx.accounts.into_transfer_to_taker_context().with_signer(&[&seeds[..]]),
            amount_expected_by_taker)?;

        // Close temp token account
        token::close_account(ctx.accounts.into_close_temp_token_context().with_signer(&[&seeds[..]]))?;

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
        constraint = *token_to_receive_account.to_account_info().owner == spl_token::id() @ ProgramError::IncorrectProgramId
    )]
    pub token_to_receive_account: Account<'info, TokenAccount>,
    #[account(
        init, payer = initializer, space = Escrow::LEN,
        constraint = !escrow_account.is_initialized @ ProgramError::AccountAlreadyInitialized
    )]
    pub escrow_account: Account<'info, Escrow>,
    #[account(address = spl_token::id())]
    pub token_program: AccountInfo<'info>,
    #[account(address = system_program::ID)]
    pub system_program: AccountInfo<'info>, // needed for init escrow_init
}

#[derive(Accounts)]
pub struct Exchange<'info> {
    #[account(mut)]
    pub taker: Signer<'info>,
    #[account(mut)]
    pub takers_sending_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub takers_token_to_receive_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub pdas_temp_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub initializers_main_account: AccountInfo<'info>,
    #[account(mut)]
    pub initializers_token_to_receive_account: Account<'info, TokenAccount>,
    #[account(mut, close = initializers_main_account,
        constraint = escrow_account.temp_token_account_pubkey == *pdas_temp_token_account.to_account_info().key @ ProgramError::InvalidAccountData,
        constraint = escrow_account.initializer_pubkey == *initializers_main_account.to_account_info().key @ ProgramError::InvalidAccountData,
        constraint = escrow_account.initializer_token_to_receive_account_pubkey == *initializers_token_to_receive_account.to_account_info().key @ ProgramError::InvalidAccountData,
    )]
    pub escrow_account: Box<Account<'info, Escrow>>,
    #[account(address = spl_token::id())]
    pub token_program: AccountInfo<'info>,
    pub pda_account: AccountInfo<'info>,
}

#[account]
pub struct Escrow {
    pub is_initialized: bool,
    pub initializer_pubkey: Pubkey,
    pub temp_token_account_pubkey: Pubkey,
    pub initializer_token_to_receive_account_pubkey: Pubkey,
    pub expected_amount: u64,
}

const DISCRIMINATOR_LENGTH: usize = 8;
const BOOL_LENGTH: usize = 1;
const PUBLIC_KEY_LENGTH: usize = 32;
const U64_LENGTH: usize = 8;

impl Escrow {
    const LEN: usize = DISCRIMINATOR_LENGTH +
        BOOL_LENGTH +
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

#[error]
pub enum ErrorCode {
    #[msg("Amount expected by taker does not match the deposited amount of intitializer.")]
    ExpectedAmountMismatch,
}

impl<'info> Exchange<'info> {
    fn into_transfer_to_initializer_context(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: self.takers_sending_token_account.to_account_info().clone(),
            to: self.initializers_token_to_receive_account.to_account_info().clone(),
            authority: self.taker.to_account_info().clone(),
        };
        let cpi_program = self.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }

    fn into_transfer_to_taker_context(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: self.pdas_temp_token_account.to_account_info().clone(),
            to: self.takers_token_to_receive_account.to_account_info().clone(),
            authority: self.pda_account.clone(),
        };
        let cpi_program = self.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }

    fn into_close_temp_token_context(&self) -> CpiContext<'_, '_, '_, 'info, CloseAccount<'info>> {
        let cpi_accounts = CloseAccount {
            account: self.pdas_temp_token_account.to_account_info().clone(),
            destination: self.initializers_main_account.clone(),
            authority: self.pda_account.clone(),
        };
        let cpi_program = self.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}