# Contributing to Fusion

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Before you start

- **Bugs:** open an issue with the *Bug report* template. Include your macOS version, the Fusion version (About Fusion) and the steps that show the problem.
- **Ideas and larger changes:** open an issue first, so we can agree on the approach before you spend time on code.
- **Security problems:** do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Set up

You need an Apple Silicon Mac with macOS 13 or later, Node 24+, Rust stable (`brew install rustup && rustup default stable`) and the Xcode Command Line Tools.

```sh
git clone https://github.com/<you>/fusion.git && cd fusion
npm ci
npm run tauri dev
```

Dev and release builds share the same data folder (`~/Library/Application Support/dev.fusion.ide/`), so quit one before you start the other.

## Check your change

Run what CI runs before you open a pull request:

```sh
npx tsc -b                 # type check
npm run build              # frontend build
cd src-tauri && cargo test # Rust tests
```

If you change the UI, describe what you checked by hand in the app, and add a screenshot or short recording to the pull request.

## Code style

- Match the code around your change: naming, comment density, idioms.
- Comments say *why*, in short plain sentences.
- Keep changes focused: one fix or feature per pull request.
- No new runtime dependency without a reason in the pull request.
- Put Rust unit tests next to the code (`#[cfg(test)] mod tests`).

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Make your change, with tests where it makes sense.
3. Use a [Conventional Commits](https://www.conventionalcommits.org/) title: `feat: …`, `fix: …`, `perf: …`, `docs: …`, `chore: …`.
4. Open the pull request and fill in the template. CI must pass.

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE).
