Create independent black-box browser probes from only the supplied requirement evidence. Return JSON matching the schema. Cover every supplied requirement ID. Each case must have a final assertion object (expectVisible, expectText, expectValue or expectCount), separate from steps. Use only the listed operations and accessible locators.

## Test design principles
Each probe case tests exactly ONE atomic behavior. Follow the pattern: setup prerequisites → navigate → interact → assert outcome. This mirrors how real acceptance tests are structured: one test per requirement, one behavior per test.

## Case selection priority
1. Always cover the happy path: the primary user flow the requirement describes.
2. Add boundary and negative cases when the evidence states or implies: validation rules (required fields, length limits, format constraints, numeric ranges), uniqueness constraints, persistence behavior (state survives reload), or permission/access control.
3. For boundary cases: submit empty values, oversized inputs, invalid formats, duplicate submissions. Assert the declared error feedback AND assert the absence of success effects (expectCount with count 0, or absence of success text).
4. For seed data: include a case that asserts the declared items appear verbatim where the app lists them. Treat seed records as available prerequisite data.
5. Spend the case budget on boundary cases before extra happy-path variants. Never assert feedback the evidence does not state.

## Locator strategy
For repeated controls, set scope to the containing role (row, article, listitem, dialog) with optional literal hasText from requirement evidence or an earlier fill value, then target the control within that scope. Scopes must be flat.
Use role, label, or text with the exact strings declared in the evidence, including exactUiStrings. Strings match literally, case-insensitively, as substrings unless exact is true; never use regular expression syntax, alternation, or wildcards. Prefer role with name for buttons, links, checkboxes, headings, and alerts; prefer label for form controls; keep the app's declared language instead of translating labels.
Give key locators one or two fallbacks describing other accessible renderings of the same control — for example role button with the same name, then label, then plain text — ordered most specific first; every fallback must reuse strings declared in the evidence and fallbacks must not nest.

## Locator pitfalls
When exactUiStrings is empty, prefer structural roles without a guessed name, such as main for the main workspace or textbox for a unique input. A requirement to display the home page describes a page state, not literal text Home or a Home button: navigate to / and assert the required visible regions. Plain text locators without a declared exactUiString, seed item, or earlier fill value require a role or label fallback for the same target. Never turn descriptive words into required UI labels or invent seed records.

## Step patterns
Begin each case with goto to the route the scenario needs, including deep links declared in the evidence. Use click to exercise visible entry points the requirement demands. Use fill and select with valid declared data, press for keyboard behavior, reload to verify state survives a page refresh, and newContext only to switch to a different actor or session.

## Assertion patterns
expectText matches the complete visible text unless exact: false, which matches a substring; assert messages with a short stable substring and exact: false. When the evidence declares alternative wordings for the same message, use expectText anyOf listing those verbatim candidates; never invent alternatives. Use expectValue for input state and expectCount with count 0 to assert absence, such as no signed-in session or no created record. For rejected actions, assert the required visible feedback and the absence of success effects. Never invent operations, locators, or behavior the evidence does not state.

Each case runs in a fresh browser context and must establish its own prerequisites.
