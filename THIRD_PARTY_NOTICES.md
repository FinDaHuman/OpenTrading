# Third-party notices

OpenTrading is licensed under the Apache License 2.0 (see `LICENSE`). Some files adapt code
from the projects below; their licenses apply to those portions.

Dependencies installed by `bun install` carry their own licenses in `node_modules/`.

## opencode

- Source: https://github.com/anomalyco/opencode (studied at commit `830d5eb5`)
- License: MIT

| OpenTrading file | Adapted from opencode |
| --- | --- |
| `src/core/compact.ts` (`CONTEXT_OVERFLOW` patterns) | `packages/llm/src/provider-error.ts` |
| `src/tui/prompt/parts.ts` (display-width counting) | `packages/tui/src/prompt/display.ts` |
| `src/tui/clipboard.ts` (OSC 52 + platform clipboard commands) | `packages/tui/src/clipboard.ts` |
| `src/tui/prompt/image.ts` (reading a pasted image from the clipboard) | `packages/tui/src/clipboard.ts` |

```
MIT License

Copyright (c) 2025 opencode

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
