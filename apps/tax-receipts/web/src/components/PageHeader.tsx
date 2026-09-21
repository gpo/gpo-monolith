import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Anchor, Stack, Title } from '@mantine/core';

type PageHeaderProps = {
  title: ReactNode;
  backTo: string;
  backLabel: string;
};

/** Page title with a "back to" link underneath it, used by every top-level
 * screen. The link reads as plain text until hovered, rather than looking
 * like a normal blue link. */
export function PageHeader({ title, backTo, backLabel }: PageHeaderProps) {
  return (
    <Stack gap={2}>
      <Title order={2}>{title}</Title>
      <Anchor component={Link} to={backTo} c="dimmed" underline="hover" size="sm">
        &larr; {backLabel}
      </Anchor>
    </Stack>
  );
}
