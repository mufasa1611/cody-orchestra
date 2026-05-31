# Cody Pro Web Research

The upstream `webfetch` tool is available for page reads. The upstream search tool depends on provider capability, so Cody Pro also includes a provider-independent web search wrapper.

## Tools

- `cody-web-search`: fixed Bing HTML search endpoint, returns title, URL, and snippet.
- `cody-web-read`: reads one HTTP/HTTPS URL and returns cleaned page text.
- `cody-source-summarize`: extracts compact source notes from supplied text.
- `cody-citation-format`: formats newline-delimited source notes into markdown citations.

## Isolation

The `web-research` agent has:

```yaml
permission:
  edit: deny
  bash: deny
  task: deny
```

It also explicitly disables Cody infra inspection tools so research work does not drift into local administration.

## Smoke Tests

```powershell
cody-pro debug agent web-research --tool cody-web-search --params '"{\"query\":\"cody-pro\",\"limit\":2,\"timeoutSeconds\":15}"'
cody-pro debug agent web-research --tool cody-web-read --params '"{\"url\":\"https://example.com\",\"timeoutSeconds\":10}"'
cody-pro debug agent web-research --tool cody-source-summarize --params '"{\"title\":\"Example\",\"url\":\"https://example.com\",\"text\":\"This-domain-is-for-use-in-documentation-examples-without-needing-permission.\",\"maxSentences\":1}"'
cody-pro debug agent web-research --tool cody-citation-format --params '"{\"sourcesText\":\"Example;https://example.com;Documentation-example-domain\"}"'
```


