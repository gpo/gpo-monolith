---
last-reviewed: 2026-10-12
review-interval-days: 90
---

# Tax Receipts tool: UI patterns for tables and modals

How list screens in the web app (`apps/tax-receipts/web`) show records and
let people add or change them. Follow these when building or changing a
screen that lists records; the code layout itself is in
[`architecture.md`](architecture.md).

The app uses Mantine with the theme in `web/src/theme.ts`. The primary
colour is `gpoGreen` (shade 6 is the GPO logo green, `#2f772f`), so a
`Button` with no `color` prop is green. Do not pass `color="green"` or a hex
value; leave the colour off and let the theme supply it.

## Tables are read-only

A table row displays a record; it does not edit it. Show every field as text
or a `Badge`, never as an inline `NativeSelect`, `Checkbox`, or `TextInput`.

- Status-like booleans become a badge: `<Badge color="green"
  variant="light">Active</Badge>` or `<Badge color="gray"
  variant="light">Inactive</Badge>`.
- Foreign keys show the human label (for example `u.roleName`, not the role
  key).
- Empty values show `—`.

Why: inline controls save on a single click with no reason captured, so the
change log gets a generic reason, and a stray click changes production data.
Routing every change through a modal gives one place to require a reason and
show errors.

## New and edit go through modals

Creating or changing a record always happens in a `Modal`, never in a form
inline on the page.

- **New:** a `size="xs"` primary button in the card header, right-aligned
  opposite the section title, labelled "New <thing>" (or "Add <thing>"):

  ```tsx
  <Group justify="space-between">
    <Text fw={600}>Users &amp; roles</Text>
    <Button size="xs" onClick={() => setCreating(true)}>New user</Button>
  </Group>
  ```

- **Edit:** an "Edit" button in the row's actions cell (see below) opens a
  modal holding every editable field of the record, including the ones that
  used to be inline toggles (role, active, and so on).
- **Mount conditionally.** Keep the modal in its own component and render it
  only while open, so its form state starts fresh each time:
  `{editing && <EditUserModal user={editing} onClose={() => setEditing(null)} />}`.
  The component renders `<Modal opened onClose={onClose} title=...>`. One
  component may serve both new and edit by taking `record | null` (see
  `RoleEditor` in `routes/admin-roles.tsx`).
- **Inside the modal:** a vertical `Stack gap="sm"` of fields, then any
  `Alert color="red"` for the mutation error, then a footer
  `<Group justify="flex-end">` with a `variant="default"` Cancel and the
  primary submit button on the right.
- **Explain disabled submits.** If the submit button is disabled until input
  is valid, the reason must be visible on the field (a `description` and an
  `error` once the user has typed), not only in a long label that can be
  truncated. Example: the temporary password field in `CreateUserModal`
  shows "At least 12 characters (N so far)".
- **Reasons.** Edits to change-logged records take a "Reason (required)"
  field of at least 3 characters, sent as `reason` to the API.
- **Send only what changed** for fields the API treats as separate actions
  (for example role and active on a user), so the change log records what
  actually changed.
- **On success** invalidate the affected queries, then call `onClose()`.
  Errors stay in the modal.

## Row action buttons

Buttons inside a table cell are deliberately quiet, so the data stays the
focus of the table:

- `size="xs" variant="subtle"` with no `color`, which renders as green text
  with no fill until hovered.
- Keep a semantic colour only where it carries meaning: `color="red"` for
  destructive actions (Remove), `color="yellow"` for exceptions. These stay
  `variant="subtle"` too.
- An inline step that commits typed input (the work-queue Confirm) may stay
  a filled button, since it is the end of a form rather than a row action.

## Alignment

When action buttons are in the last cell of a row, right-align them:

- Several buttons: `<Group gap="xs" wrap="nowrap" justify="flex-end">`.
- A single button: `<Table.Td ta="right">`.
- The header cell above an actions column is an empty `<Table.Th />`.

Buttons in a cell that is not last (for example "Mark sent" in the middle of
an entity-reports row) keep the cell's normal alignment.

## Known deviations

These predate the pattern; bring them in line when next touching them.

- Periods, contribution limit buckets, holidays, and leadership contestants
  on the Admin page still use inline forms below their tables rather than a
  New modal.
- Ridings uses one always-mounted `Modal` with `opened={modalOpened}` and
  resets its form by hand instead of mounting conditionally.
- Leadership contestants toggle active status from a row button with a
  shared reason field, not an Edit modal.
