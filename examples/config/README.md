# Configuration example

The scaffold currently loads environment variables through `Settings`; TOML loading is not
implemented. Copy the repository's `.env.example` to `.env`. The copied file is valid without any
remote URL or credential. Uncomment a source only after its adapter contract has been verified.

`opentrading doctor` validates local configuration without making remote requests.
