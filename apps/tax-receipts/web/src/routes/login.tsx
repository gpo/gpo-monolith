import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  Alert,
  Button,
  Card,
  PasswordInput,
  Stack,
  TextInput,
  Title,
} from '@mantine/core';
import { api, ApiError } from '../api.js';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(email, password);
      await qc.invalidateQueries({ queryKey: ['me'] });
      await navigate({ to: '/' });
    } catch (err) {
      setError(
        err instanceof ApiError ? 'Invalid email or password.' : 'Login failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card withBorder maw={380} component="form" onSubmit={submit}>
      <Stack>
        <Title order={3}>Sign in</Title>
        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}
        <TextInput
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          required
        />
        <PasswordInput
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          required
        />
        <Button type="submit" loading={busy}>
          Sign in
        </Button>
      </Stack>
    </Card>
  );
}
