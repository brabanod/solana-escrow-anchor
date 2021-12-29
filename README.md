# Solana Escrow Anchor
Escrow program (presented in [this tutorial](https://paulx.dev/blog/2021/01/14/programming-on-solana-an-introduction/) by Paul Schaaf) using the [Anchor](https://github.com/project-serum/anchor) framework by Project Serum.

> **NOTE:** This project aims to exactly copy the mechanisms presented in the [tutorial](https://paulx.dev/blog/2021/01/14/programming-on-solana-an-introduction/), without making any improvements to the general escrow mechanism (like this [anchor escrow tutorial](https://hackmd.io/@ironaddicteddog/solana-anchor-escrow) for example). The goal is to give an **easy introduction** to the Anchor framework for everyone, who read the tutorial.

## Run

Run all tests
```console
$ anchor test
```

Run tests isolated
```console
$ anchor localnet

// new terminal
$ anchor run test-setup
$ anchor run test-alice
$ anchor run test-bob
```

## Credits

The project is based on the [escrow tutorial](https://paulx.dev/blog/2021/01/14/programming-on-solana-an-introduction/) of Paul Schaaf.
Large parts of the test scripts in this project are copied and adapted from the original [implementation](https://github.com/paul-schaaf/solana-escrow).
