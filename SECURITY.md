# Security policy

## Report a vulnerability

Please **do not** open a public issue for a security problem.

Report it privately with GitHub's [private vulnerability reporting](https://github.com/yevgeniyo-ps/fusion/security/advisories/new). Include:

- what the problem is and what an attacker could do with it,
- the steps or a proof of concept to reproduce it,
- the Fusion and macOS versions.

You will get a reply within 7 days. Once a fix is released, the advisory is published and you are credited, unless you ask not to be.

## Supported versions

Only the latest release gets security fixes.

## Scope

Fusion runs local shells and `git` and `gh` with your own permissions, and gives `claude` access to the projects of a tab. Issues of particular interest:

- a way for web content or a file's contents to run commands,
- a tab's `claude` reaching folders outside that tab's projects,
- Fusion leaking tokens, credentials or file contents.
