# Third-party notices

The project's own code is MIT-licensed under `LICENSE` (2026 Phototonic).
That grant does not replace the following vendor and adaptation terms. This file
accompanies the Git distribution and both extension and companion folder/ZIP
distributions. It inventories code actually bundled, not every development dependency.

| Bundled package | Version | Where its code is included |
| --- | --- | --- |
| @openchamber/sdk | 2.5.1 | Three guest views and host service |
| zod | 4.6.7 | Host service |
| @opencode/plugin | 2.1.4 | Companion |
| @opencode/schema | 2.1.4 | Companion |
| effect | 4.0.1 | Companion |

The extension includes the service, guests, companion and setup. The companion
installer includes the companion and setup; setup itself has no bundled vendor code.
Both distributions carry this complete notice file so that credits are not lost.

## @openchamber/sdk 2.5.1 — MIT

Source: https://github.com/openchamber/openchamber/tree/main/packages/sdk
Notice: the installed 2.5.1 package's `LICENSE`.

```text
MIT License

Copyright (c) 2025 Bohdan Triapitsyn

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

## zod 4.6.7 — MIT, with embedded-source credits below

Source: https://github.com/colinhacks/zod
Notice: the installed 4.6.7 package's `LICENSE`.

```text
MIT License

Copyright (c) 2025 Colin McDonnell

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

## @opencode/plugin and @opencode/schema 2.1.4 — MIT

Both installed packages declare MIT but omit a packaged LICENSE file. Their
upstream version `v2.1.4` resolves to commit
`68bc26b7da1990ce10ffecfbc1e09eb13aa5d824`; the following root grant applies to both.
Source: https://github.com/anomalyco/opencode/blob/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824/LICENSE

```text
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

## effect 4.0.1 — MIT, with cookie-source credits below

Source: https://github.com/Effect-TS/effect
Notice: the installed 4.0.1 package's `LICENSE`.

```text
MIT License

Copyright (c) 2023 Effectful Technologies Inc

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

## Embedded datetime adaptation — Brock Adams / CC BY-SA 2.5

Zod's `v4/core/regexes.js` identifies its `datetime` implementation as adapted from
[Brock Adams's answer 3143231](https://stackoverflow.com/a/3143231).
Author: [Brock Adams](https://stackoverflow.com/users/331508/brock-adams).
The original answer (2010) is identified by the Stack Exchange API as
**Creative Commons Attribution-ShareAlike 2.5 Generic (CC BY-SA 2.5)**:
https://creativecommons.org/licenses/by-sa/2.5/
Full terms: https://creativecommons.org/licenses/by-sa/2.5/legalcode

Zod changed the original datetime-regex presentation into its parameterized
date/time validation implementation. This distribution bundles that Zod
implementation into `build/service/main.js`; it is not the unchanged original
answer. This preserves the identified author, source, license and adaptation
credit, without asserting that attribution alone determines ShareAlike's reach.

## Embedded Luhn adaptation — Valibot / MIT

Zod's `v4/core/schemas.js` identifies its Luhn checksum as adapted from Valibot.
That adaptation is included in `build/service/main.js`.
Canonical source/license: https://github.com/open-circle/valibot/blob/main/LICENSE.md

```text
MIT License

Copyright (c) Fabian Hiller

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Embedded cookie adaptations — Fastify, James Sumners, jshttp/cookie / MIT

Effect's `http/Cookies` identifies cookie serialization and header parsing as
adapted from fastify-cookie. These implementations are bundled in
`build/companion/index.js`. The canonical fastify-cookie `v9.4.0/cookie.js` itself
credits jshttp/cookie and carries the Roman Shtylman/Douglas Christopher Wilson
grant reproduced below. The earlier `v1.0.0` package declares a dependency on
`cookie` `^0.3.1`; its README links James Sumners's MIT license. These are bounded
origin references, not a claim that Effect copied either exact revision.

Sources:
- https://github.com/fastify/fastify-cookie/blob/v9.4.0/LICENSE
- https://github.com/fastify/fastify-cookie/blob/v9.4.0/cookie.js
- https://github.com/fastify/fastify-cookie/blob/v1.0.0/README.md
- https://github.com/jshttp/cookie/blob/v0.3.1/LICENSE
- https://jsumners.mit-license.org/

The current Fastify notice is also preserved alongside the historical notice:
https://github.com/fastify/fastify-cookie/blob/main/LICENSE
The linked James Sumners license renders the current year (2026 when retrieved);
this does not establish an original copying year.

```text
MIT License

Copyright (c) Fastify
Copyright (c) 2017-present The Fastify team <https://github.com/fastify/fastify#team>
Copyright © 2026 James Sumners <james.sumners@gmail.com>

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

```text
(The MIT License)

Copyright (c) 2012-2014 Roman Shtylman <shtylman@gmail.com>
Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Embedded traversal adaptation — Jaen / Apache-2.0

**Adaptation/modification notice for `build/service/main.js`:** its bundled Zod
`v4/core/visit.js` traversal is not Jaen's original file. Zod adapted the v3
`mapOnSchema` pattern to its traversal implementation; this distribution
mechanically bundles that implementation with other service code. The upstream
adaptation credit is preserved here with the original notice and full license.
This accompanying notice identifies the affected object-form bundle; no original
gist source file is redistributed as an unchanged source file.

Source: https://gist.github.com/jaens/7e15ae1984bb338c86eb5e452dee3010
Revision: `35945207ee1883bb0c18c04b95e90b71e9ebfe05`, `zod-deep-strict-partial.ts`.
Zod's source carries this adaptation notice at the beginning of `v4/core/visit.js`:

```text
// Traversal pattern adapted from Jaen's v3 `mapOnSchema` (Apache-2.0): https://gist.github.com/jaens/7e15ae1984bb338c86eb5e452dee3010
```

Original notice:

```text
Copyright 2024, Jaen - https://github.com/jaens

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

The full Apache License 2.0 is in `licenses/Apache-2.0.txt`, supplied with this
file in Git and both distributions. If modifying and redistributing the adapted
source, retain its source attribution and place a prominent change notice in the
modified file as required by section 4(b); this notice is not a waiver of that
condition. No separate upstream NOTICE file was present in the cited gist.

## Interpretation and provenance limits

The package-level MIT grants do not erase embedded-source terms. The exact cookie
copying revision is not established. The datetime citation identifies CC BY-SA
material but does not itself determine copyrightability, which portions require
that grant, or ShareAlike's reach. These notices record known provenance and terms;
they are not legal clearance, a claim that everything is MIT, or a declaration
that the entire project is ShareAlike. Redistributors must consider the applicable
terms for their use and preserve these notices.
