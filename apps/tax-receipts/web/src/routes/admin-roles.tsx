import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { ApiError, api, type PermissionRow, type RoleRow } from '../api.js';

/**
 * Admin > Roles (EO evaluation rows 7 and 8): create roles and choose which
 * system functions each one may perform. The functions themselves are the
 * permission catalogue the server defines (`GET /admin/permissions`); this
 * page only assigns them. Users are assigned a role on the Users page.
 *
 * Every write carries a reason and lands in the change log (subject Role).
 * The system administrator role is locked; built-in roles can be edited
 * but not deleted; a role still held by a user cannot be deleted.
 */
export function RolesSection() {
  const roles = useQuery({ queryKey: ['admin-roles'], queryFn: api.listRoles });
  const permissions = useQuery({ queryKey: ['admin-permissions'], queryFn: api.listPermissions });
  // null: closed; 'new': creating; a role: editing it
  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null);

  if (roles.isLoading || permissions.isLoading) return <Loader />;
  if (roles.isError || permissions.isError || !roles.data || !permissions.data) {
    return <Alert color="red">Failed to load roles.</Alert>;
  }
  const labels = new Map(permissions.data.data.map((p) => [p.key, p.label]));

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <div>
            <Text fw={600}>Roles</Text>
            <Text size="sm" c="dimmed">
              A role is a named set of permissions. Assign roles to people on the Users page.
            </Text>
          </div>
          <Button onClick={() => setEditing('new')}>New role</Button>
        </Group>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Role</Table.Th>
              <Table.Th>Permissions</Table.Th>
              <Table.Th w={70}>Users</Table.Th>
              <Table.Th w={90} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {roles.data.data.map((role) => (
              <Table.Tr key={role.key}>
                <Table.Td>
                  <Group gap="xs">
                    <Text size="sm" fw={500}>{role.name}</Text>
                    {role.locked ? (
                      <Badge size="xs" color="gray">Locked</Badge>
                    ) : role.builtIn ? (
                      <Badge size="xs" variant="light">Built-in</Badge>
                    ) : null}
                  </Group>
                  {role.description && <Text size="xs" c="dimmed">{role.description}</Text>}
                </Table.Td>
                <Table.Td>
                  {role.permissions.length === 0 ? (
                    <Text size="sm" c="dimmed">Read the operational screens only</Text>
                  ) : (
                    <Group gap={4}>
                      {role.permissions.map((p) => (
                        <Badge key={p} size="sm" variant="outline" tt="none">
                          {labels.get(p) ?? p}
                        </Badge>
                      ))}
                    </Group>
                  )}
                </Table.Td>
                <Table.Td>{role.userCount}</Table.Td>
                <Table.Td>
                  <Button size="xs" variant="light" onClick={() => setEditing(role)}>
                    {role.locked ? 'View' : 'Edit'}
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Stack>
      {editing && (
        <RoleEditor
          role={editing === 'new' ? null : editing}
          catalogue={permissions.data.data}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function RoleEditor({
  role,
  catalogue,
  onClose,
}: {
  role: RoleRow | null;
  catalogue: PermissionRow[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [reason, setReason] = useState('');
  const readOnly = role?.locked ?? false;

  const done = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['admin-roles'] }),
      qc.invalidateQueries({ queryKey: ['admin-users'] }),
      qc.invalidateQueries({ queryKey: ['me'] }),
    ]);
    onClose();
  };
  const save = useMutation({
    mutationFn: () => {
      const input = { name, description, permissions: [...selected], reason };
      return role ? api.updateRole(role.key, input) : api.createRole(input);
    },
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteRole(role!.key, reason),
    onSuccess: done,
  });
  const error = save.error ?? remove.error;

  const groups = new Map<string, PermissionRow[]>();
  for (const p of catalogue) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);

  const toggle = (key: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(key);
    else next.delete(key);
    setSelected(next);
  };

  const reasonOk = reason.trim().length >= 3;
  const deletable = role !== null && !role.builtIn && role.userCount === 0;

  return (
    <Modal opened onClose={onClose} size="lg" title={role ? role.name : 'New role'}>
      <Stack gap="sm">
        {readOnly && (
          <Alert color="gray">
            The system administrator role always has full access and cannot be changed, so the tool can
            never be left without someone able to manage it.
          </Alert>
        )}
        <TextInput
          label="Name"
          value={name}
          disabled={readOnly}
          onChange={(e) => setName(e.currentTarget.value)}
          description={role ? `Key: ${role.key}` : undefined}
        />
        <Textarea
          label="Description"
          value={description}
          disabled={readOnly}
          autosize
          minRows={1}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
        {[...groups.entries()].map(([group, perms]) => (
          <Stack key={group} gap={6}>
            <Text size="sm" fw={600}>{group}</Text>
            {perms.map((p) => (
              <Checkbox
                key={p.key}
                label={p.label}
                description={p.description}
                checked={selected.has(p.key)}
                disabled={readOnly}
                onChange={(e) => toggle(p.key, e.currentTarget.checked)}
              />
            ))}
          </Stack>
        ))}
        {!readOnly && (
          <TextInput
            label="Reason for this change (required)"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
        )}
        {error && (
          <Alert color="red">{error instanceof ApiError ? error.message : 'Something went wrong.'}</Alert>
        )}
        {!readOnly && (
          <Group justify="space-between">
            <Group>
              {role && !role.builtIn && (
                <Button
                  color="red"
                  variant="light"
                  disabled={!deletable || !reasonOk}
                  title={role.userCount > 0 ? 'Assign its users another role first' : undefined}
                  loading={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  Delete role
                </Button>
              )}
            </Group>
            <Group>
              <Button variant="default" onClick={onClose}>Cancel</Button>
              <Button
                disabled={!name.trim() || !reasonOk}
                loading={save.isPending}
                onClick={() => save.mutate()}
              >
                {role ? 'Save role' : 'Create role'}
              </Button>
            </Group>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}
