import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Pagination,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { dashboardFor } from '@mm/shared-types';
import type { Role, UserDto } from '@mm/shared-types';
import { api, qs } from '../../lib/api.ts';
import type { ApiClientError } from '../../lib/api.ts';
import { useAuthStore } from '../../lib/auth-store.ts';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews.tsx';

interface OperatorOption {
  id: string;
  code: string;
  name: string;
}

/** The roles a person can hold. `device` is for machine API keys, not people. */
const PERSON_ROLES: Array<{ role: Role; label: string; what: string }> = [
  { role: 'commuter', label: 'Commuter', what: 'Rents vehicles and plans trips' },
  { role: 'operator', label: 'Operator', what: "Runs one company's fleet" },
  { role: 'planner', label: 'Planner', what: 'Runs scenarios and sites infrastructure' },
  { role: 'analyst', label: 'Analyst', what: 'Reads analytics and retrains the model' },
  { role: 'admin', label: 'Admin', what: 'Everything, including users and roles' },
];

const PAGE_SIZE = 20;

function EditRolesDialog({
  user,
  operators,
  onClose,
}: {
  user: UserDto | null;
  operators: OperatorOption[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [roles, setRoles] = useState<Role[]>([]);
  const [operatorId, setOperatorId] = useState('');

  useEffect(() => {
    if (user) {
      setRoles(user.roles.filter((r) => r !== 'device'));
      setOperatorId(user.operatorId ?? '');
    }
  }, [user]);

  const save = useMutation({
    mutationFn: () =>
      api.patch<UserDto>(`/admin/users/${user!.id}/roles`, {
        roles,
        operatorId: roles.includes('operator') ? operatorId || null : null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      onClose();
    },
  });

  const toggle = (role: Role) =>
    setRoles((cur) => (cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role]));

  const needsCompany = roles.includes('operator') && !operatorId;
  const error = save.error as ApiClientError | null;

  return (
    <Dialog open={user !== null} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Roles · {user?.fullName}</DialogTitle>
      <DialogContent className="flex flex-col gap-1">
        <Typography variant="caption" color="text.secondary" className="mb-1">
          {user?.email}
        </Typography>
        {PERSON_ROLES.map(({ role, label, what }) => (
          <FormControlLabel
            key={role}
            control={<Checkbox checked={roles.includes(role)} onChange={() => toggle(role)} />}
            label={
              <Box className="flex flex-col leading-tight">
                <Typography variant="body2">{label}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {what}
                </Typography>
              </Box>
            }
          />
        ))}

        {roles.includes('operator') && (
          <TextField
            select
            size="small"
            label="Operator company"
            value={operatorId}
            onChange={(e) => setOperatorId(e.target.value)}
            error={needsCompany}
            helperText={
              needsCompany
                ? 'Required: an operator only ever sees their own company’s fleet'
                : 'They will see and manage only this company’s vehicles'
            }
            className="mt-2"
          >
            {operators.map((o) => (
              <MenuItem key={o.id} value={o.id}>
                {o.name}
              </MenuItem>
            ))}
          </TextField>
        )}

        {roles.length > 0 && (
          <Typography variant="body2" className="mt-2">
            Signs in to: <b>{dashboardFor(roles).label}</b>
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          Takes effect when they next sign in, or within 15 minutes.
        </Typography>

        {roles.length === 0 && <Alert severity="warning">A user must hold at least one role.</Alert>}
        {error && (
          <Alert severity="error">
            {error.code === 'VALIDATION_FAILED' ? (error.details?.[0]?.message ?? error.message) : error.message}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={roles.length === 0 || needsCompany || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : 'Save roles'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Admin: who can do what. Self-registration only ever grants `commuter`, so
 * this is the one place anyone becomes an operator, planner, analyst or admin.
 */
export function UsersPanel() {
  const me = useAuthStore((s) => s.user);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<UserDto | null>(null);

  // Search when typing pauses, not on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const users = useQuery({
    queryKey: ['admin', 'users', { term, role, page }],
    queryFn: () =>
      api.get<UserDto[]>(
        `/admin/users${qs({ page, limit: PAGE_SIZE, q: term || undefined, role: role || undefined })}`,
      ),
    placeholderData: (prev) => prev,
  });

  const operators = useQuery({
    queryKey: ['admin', 'operators'],
    queryFn: () => api.get<OperatorOption[]>('/admin/operators'),
    staleTime: 10 * 60_000,
  });
  const operatorList = operators.data?.data ?? [];
  const companyName = (id: string | null) => operatorList.find((o) => o.id === id)?.name ?? null;

  const list = users.data?.data ?? [];
  const total = users.data?.meta?.total ?? 0;

  return (
    <Box className="flex flex-col gap-3">
      <Box className="flex flex-wrap gap-3">
        <TextField
          size="small"
          label="Search name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[240px] flex-1"
        />
        <TextField
          select
          size="small"
          label="Role"
          value={role}
          onChange={(e) => {
            setRole(e.target.value as Role | '');
            setPage(1);
          }}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All roles</MenuItem>
          {PERSON_ROLES.map((r) => (
            <MenuItem key={r.role} value={r.role}>
              {r.label}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      {users.isLoading && <LoadingState rows={4} />}
      {users.error && (
        <ErrorState error={users.error as ApiClientError} onRetry={() => void users.refetch()} />
      )}
      {users.data && list.length === 0 && (
        <EmptyState
          title="No users match"
          action="Clear the search or the role filter. New people appear here as commuters once they sign up."
        />
      )}

      {list.map((u) => (
        <Paper
          key={u.id}
          elevation={0}
          className="flex flex-col gap-2 p-3 shadow-card sm:flex-row sm:items-center sm:gap-4"
        >
          <Box className="min-w-0 flex-1">
            <Typography variant="body2" className="truncate">
              {u.fullName}
              {u.id === me?.id && (
                <Typography component="span" variant="caption" color="text.secondary">
                  {' '}
                  (you)
                </Typography>
              )}
            </Typography>
            <Typography variant="caption" color="text.secondary" className="block truncate">
              {u.email}
              {u.operatorId && companyName(u.operatorId) ? ` · ${companyName(u.operatorId)}` : ''}
            </Typography>
          </Box>
          <Box className="flex flex-wrap gap-1">
            {u.roles.map((r) => (
              <Chip
                key={r}
                size="small"
                variant={r === 'admin' ? 'filled' : 'outlined'}
                color={r === 'admin' ? 'primary' : 'default'}
                label={r}
              />
            ))}
            {u.status !== 'active' && <Chip size="small" color="warning" label={u.status} />}
          </Box>
          <Typography variant="caption" color="text.secondary" className="whitespace-nowrap">
            {u.lastLoginAt ? `Last in ${new Date(u.lastLoginAt).toLocaleDateString()}` : 'Never signed in'}
          </Typography>
          <Button size="small" variant="outlined" onClick={() => setEditing(u)}>
            Edit roles
          </Button>
        </Paper>
      ))}

      {total > PAGE_SIZE && (
        <Pagination
          count={Math.ceil(total / PAGE_SIZE)}
          page={page}
          onChange={(_e, p) => setPage(p)}
          className="self-center"
        />
      )}

      <EditRolesDialog user={editing} operators={operatorList} onClose={() => setEditing(null)} />
    </Box>
  );
}
