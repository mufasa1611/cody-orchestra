# System Prompt

- **System prompt identity vs display name**: `system.ts:52` uses raw `model.api.id` / `model.providerID` directly — display name overrides in `provider.ts` and `tui/util/model.ts` only affect UI labels, not the model's self-introduction.
