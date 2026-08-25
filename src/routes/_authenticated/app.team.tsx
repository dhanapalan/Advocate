import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mail, MessageCircle, Minus, Plus, Users, X } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { SettingsTabs } from "@/components/app/SettingsTabs";
import { DataTable, Tag, type Tone } from "@/components/app/primitives";
import { confirmDestructive, confirmPermanentRemoval } from "@/lib/confirm";
import {
  createInvite,
  getEntitlements,
  getMyMembership,
  listInvites,
  listTeamMembers,
  removeMember,
  revokeInvite,
  setMemberRole,
  setSeatCount,
} from "@/lib/team.functions";

export const Route = createFileRoute("/_authenticated/app/team")({
  head: () => ({
    meta: [
      { title: "Team — LexDiary" },
      { name: "description", content: "Manage who has access to your chamber's account." },
    ],
  }),
  component: Team,
});

type Member = { id: string; full_name: string | null; tenant_role: string; created_at: string };
type Invite = {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  expires_at: string;
  token?: string;
};
type Entitlements = {
  plan: string;
  status: string;
  seats: number;
  seats_included: number;
  seats_used: number;
  extra_seats: number;
  extra_seat_price_inr: number | null;
  base_price_inr: number;
  monthly_total_inr: number;
  ocr_enabled: boolean;
  whatsapp_enabled: boolean;
  team_enabled: boolean;
  matters_limit: number | null;
  clients_limit: number | null;
  storage_limit_mb: number | null;
  trial_ends_at: string | null;
  trial_days_left: number | null;
  trial_expired: boolean;
  trial_period_days: number;
};

const inviteStatusTone: Record<string, Tone> = {
  pending: "warning",
  accepted: "success",
  revoked: "neutral",
  expired: "danger",
};

const planLabel: Record<string, string> = {
  trial: "Trial",
  solo_basic: "Solo Basic",
  solo_pro: "Solo Pro",
  chamber: "Chamber",
};

const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function Team() {
  const loadMembers = useServerFn(listTeamMembers);
  const loadInvites = useServerFn(listInvites);
  const addInvite = useServerFn(createInvite);
  const cancelInvite = useServerFn(revokeInvite);
  const loadEntitlements = useServerFn(getEntitlements);
  const loadMe = useServerFn(getMyMembership);
  const changeRole = useServerFn(setMemberRole);
  const dropMember = useServerFn(removeMember);
  const changeSeats = useServerFn(setSeatCount);

  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [me, setMe] = useState<{ id: string; tenant_role: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviting, setInviting] = useState(false);
  const [busyMember, setBusyMember] = useState<string | null>(null);
  const [seatBusy, setSeatBusy] = useState(false);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);

  const isAdmin = me?.tenant_role === "owner" || me?.tenant_role === "admin";
  const teamEnabled = ent?.team_enabled ?? false;
  const seatsFree = ent ? ent.seats - ent.seats_used : 0;

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const [m, i, e, mine] = await Promise.all([
        loadMembers(),
        loadInvites(),
        loadEntitlements(),
        loadMe(),
      ]);
      setMembers(m as Member[]);
      setInvites(i as Invite[]);
      setEnt(e as Entitlements | null);
      setMe(mine as { id: string; tenant_role: string } | null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load team data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setError(null);
    setNotice(null);
    setLastInviteLink(null);
    try {
      const invite = (await addInvite({
        data: { email: inviteEmail.trim(), role: inviteRole },
      })) as Invite;
      setInviteEmail("");
      if (invite.token) setLastInviteLink(`${window.location.origin}/invite/${invite.token}`);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to send invite.");
    } finally {
      setInviting(false);
    }
  }

  async function handleRevoke(id: string, email: string) {
    if (
      !confirmDestructive(
        `Revoke the invite for ${email}? Their invite link stops working immediately and the seat is freed.`,
      )
    )
      return;
    setError(null);
    try {
      await cancelInvite({ data: { id } });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to revoke invite.");
    }
  }

  async function handleRoleChange(userId: string, role: "owner" | "admin" | "member") {
    setError(null);
    setNotice(null);
    setBusyMember(userId);
    try {
      await changeRole({ data: { userId, role } });
      await reload();
      setNotice("Role updated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to change role.");
    } finally {
      setBusyMember(null);
    }
  }

  async function handleRemove(member: Member) {
    const name = member.full_name ?? "this member";
    if (
      !confirmPermanentRemoval(
        `${name} from the chamber`,
        "Their login is revoked and the seat is freed.",
      )
    )
      return;
    setError(null);
    setNotice(null);
    setBusyMember(member.id);
    try {
      await dropMember({ data: { userId: member.id } });
      await reload();
      setNotice("Member removed and seat freed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to remove member.");
    } finally {
      setBusyMember(null);
    }
  }

  async function handleSeatChange(delta: number) {
    if (!ent) return;
    if (
      delta < 0 &&
      !confirmDestructive(
        `Release a seat? Your chamber drops to ${ent.seats - 1} seats and your monthly bill falls to ₹${(
          ent.monthly_total_inr - (ent.extra_seat_price_inr ?? 0)
        ).toLocaleString("en-IN")}.`,
      )
    )
      return;
    setError(null);
    setNotice(null);
    setSeatBusy(true);
    try {
      const next = ent.seats + delta;
      await changeSeats({ data: { seats: next } });
      await reload();
      setNotice(
        delta > 0
          ? `Seat added. Your chamber now has ${next} seats.`
          : `Seat removed. Your chamber now has ${next} seats.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to change the seat count.");
    } finally {
      setSeatBusy(false);
    }
  }

  return (
    <AppShell title="Team" subtitle="Manage who has access to your chamber's account">
      <SettingsTabs />
      {error ? (
        <p className="mb-4 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-4 rounded border border-accent/30 bg-accent/10 px-3 py-2 text-sm">
          {notice}
        </p>
      ) : null}

      {ent && ent.plan === "trial" ? (
        <p
          className={
            ent.trial_expired
              ? "mb-4 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              : "mb-4 rounded border border-accent/30 bg-accent/10 px-3 py-2 text-sm"
          }
        >
          {ent.trial_expired ? (
            <>
              Your {ent.trial_period_days}-day free trial has ended. Everything you entered is still
              readable and exportable — choose a plan to start adding to it again.
            </>
          ) : (
            <>
              Free trial — {ent.trial_days_left} {ent.trial_days_left === 1 ? "day" : "days"} left
              of {ent.trial_period_days}. No card on file; nothing is charged unless you choose a
              plan.
            </>
          )}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px] [&>*]:min-w-0">
        <div>
          <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold">
            <Users className="size-4" />
            Members
          </h2>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <DataTable headers={["Name", "Role", "Joined", ""]}>
              {members.map((member) => {
                const isSelf = member.id === me?.id;
                return (
                  <tr key={member.id} className="hover:bg-secondary/40">
                    <td className="px-4 py-3 font-medium">
                      {member.full_name ?? "—"}
                      {isSelf ? (
                        <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {isAdmin && !isSelf ? (
                        <select
                          value={member.tenant_role}
                          disabled={busyMember === member.id}
                          onChange={(event) =>
                            void handleRoleChange(
                              member.id,
                              event.target.value as "owner" | "admin" | "member",
                            )
                          }
                          className="rounded border border-input bg-background px-2 py-1 text-xs disabled:opacity-60"
                        >
                          <option value="member">member</option>
                          <option value="admin">admin</option>
                          <option value="owner">owner</option>
                        </select>
                      ) : (
                        <Tag tone={member.tenant_role === "member" ? "neutral" : "accent"}>
                          {member.tenant_role}
                        </Tag>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(member.created_at).toLocaleDateString("en-IN")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isAdmin && !isSelf && member.tenant_role !== "owner" ? (
                        <button
                          type="button"
                          disabled={busyMember === member.id}
                          onClick={() => void handleRemove(member)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-destructive hover:underline disabled:opacity-60"
                        >
                          <X className="size-3.5" />
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </DataTable>
          )}

          {!loading && !teamEnabled ? (
            <div className="surface-panel mt-6 rounded p-5">
              <h3 className="font-display text-sm font-bold">Add a teammate</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Your {planLabel[ent?.plan ?? "trial"] ?? ent?.plan} plan covers a single advocate.
                The Chamber plan starts at {rupees(7999)} a month for two users, with extra seats at{" "}
                {rupees(1999)} each — ask the platform admin to move your chamber onto it and this
                screen will let you invite and manage teammates here.
              </p>
            </div>
          ) : null}

          {teamEnabled ? (
            <>
              <form
                onSubmit={handleInvite}
                className="surface-panel mt-6 mb-4 flex flex-wrap items-end gap-3 rounded p-4"
              >
                <label className="flex-1 text-sm">
                  <span className="text-eyebrow">Invite by email</span>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="junior@example.com"
                    className="mt-1.5 w-full rounded border border-input bg-background px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-eyebrow">Role</span>
                  <select
                    value={inviteRole}
                    onChange={(event) => setInviteRole(event.target.value as "admin" | "member")}
                    className="mt-1.5 rounded border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <button
                  type="submit"
                  disabled={inviting || !inviteEmail.trim()}
                  className="flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-ink disabled:opacity-60"
                >
                  {inviting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  Send invite
                </button>
                {ent ? (
                  <p className="w-full text-xs text-muted-foreground">
                    {seatsFree > 0
                      ? `${seatsFree} of ${ent.seats} seats free. A pending invite holds a seat until it is accepted or revoked.`
                      : `All ${ent.seats} seats are in use — add a seat at ${rupees(ent.extra_seat_price_inr ?? 1999)} a month to invite another teammate.`}
                  </p>
                ) : null}
              </form>

              {lastInviteLink ? (
                <p className="mb-4 rounded border border-accent/30 bg-accent/10 px-3 py-2 text-sm">
                  Invite created. There's no email delivery set up yet, so share this link directly:{" "}
                  <span className="font-mono text-xs break-all">{lastInviteLink}</span>
                </p>
              ) : null}

              <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold">
                <Mail className="size-4" />
                Pending &amp; past invites
              </h2>
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : invites.length === 0 ? (
                <p className="text-sm text-muted-foreground">No invites sent yet.</p>
              ) : (
                <DataTable headers={["Email", "Role", "Status", "Sent", ""]}>
                  {invites.map((invite) => (
                    <tr key={invite.id} className="hover:bg-secondary/40">
                      <td className="px-4 py-3">{invite.email}</td>
                      <td className="px-4 py-3">
                        <Tag tone="neutral">{invite.role}</Tag>
                      </td>
                      <td className="px-4 py-3">
                        <Tag tone={inviteStatusTone[invite.status] ?? "neutral"}>
                          {invite.status}
                        </Tag>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(invite.created_at).toLocaleDateString("en-IN")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {invite.status === "pending" ? (
                          <button
                            type="button"
                            onClick={() => void handleRevoke(invite.id, invite.email)}
                            className="flex items-center gap-1 text-xs font-medium text-destructive hover:underline"
                          >
                            <X className="size-3.5" />
                            Revoke
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </DataTable>
              )}
            </>
          ) : null}
        </div>

        <aside className="space-y-4">
          <section className="surface-panel rounded p-5">
            <h2 className="font-display text-sm font-bold">Plan &amp; billing</h2>
            {ent ? (
              <>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Plan</dt>
                    <dd className="font-medium">{planLabel[ent.plan] ?? ent.plan}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Status</dt>
                    <dd className="font-medium">{ent.status}</dd>
                  </div>
                  {ent.plan === "trial" && ent.trial_ends_at ? (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Trial ends</dt>
                      <dd className="font-medium">
                        {new Date(ent.trial_ends_at).toLocaleDateString("en-IN")}
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Seats</dt>
                    <dd className="font-medium">
                      {ent.seats_used} / {ent.seats}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Base</dt>
                    <dd className="font-medium">
                      {rupees(ent.base_price_inr)}
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        / {ent.seats_included} {ent.seats_included === 1 ? "user" : "users"}
                      </span>
                    </dd>
                  </div>
                  {ent.extra_seats > 0 ? (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">
                        Extra seats ({ent.extra_seats} × {rupees(ent.extra_seat_price_inr ?? 0)})
                      </dt>
                      <dd className="font-medium">
                        {rupees(ent.extra_seats * (ent.extra_seat_price_inr ?? 0))}
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between border-t border-border pt-2">
                    <dt className="font-medium">Monthly total</dt>
                    <dd className="font-display font-bold">{rupees(ent.monthly_total_inr)}</dd>
                  </div>
                </dl>

                {teamEnabled && isAdmin ? (
                  <div className="mt-4 border-t border-border pt-4">
                    <p className="text-eyebrow">Seats</p>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={
                          seatBusy || ent.seats <= Math.max(ent.seats_included, ent.seats_used)
                        }
                        onClick={() => void handleSeatChange(-1)}
                        className="flex size-8 items-center justify-center rounded border border-input hover:bg-secondary disabled:opacity-40"
                        aria-label="Remove a seat"
                      >
                        <Minus className="size-4" />
                      </button>
                      <span className="min-w-10 text-center font-display text-lg font-bold tabular-nums">
                        {ent.seats}
                      </span>
                      <button
                        type="button"
                        disabled={seatBusy}
                        onClick={() => void handleSeatChange(1)}
                        className="flex size-8 items-center justify-center rounded border border-input hover:bg-secondary disabled:opacity-40"
                        aria-label="Add a seat"
                      >
                        <Plus className="size-4" />
                      </button>
                      {seatBusy ? (
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      ) : null}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Each seat beyond the {ent.seats_included} included costs{" "}
                      {rupees(ent.extra_seat_price_inr ?? 1999)} a month. Seats in use cannot be
                      removed — remove the member or revoke the invite first.
                    </p>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
            )}
          </section>

          <section className="surface-panel rounded p-5">
            <h2 className="font-display text-sm font-bold">Included in your plan</h2>
            {ent ? (
              <ul className="mt-3 space-y-2 text-sm">
                <li className="flex items-center justify-between">
                  <span className="text-muted-foreground">Indic OCR</span>
                  <Tag tone={ent.ocr_enabled ? "success" : "neutral"}>
                    {ent.ocr_enabled ? "Included" : "Not on this plan"}
                  </Tag>
                </li>
                <li className="flex items-center justify-between">
                  <span className="text-muted-foreground">WhatsApp</span>
                  <Tag tone={ent.whatsapp_enabled ? "success" : "neutral"}>
                    {ent.whatsapp_enabled ? "Enabled" : "Not enabled"}
                  </Tag>
                </li>
                <li className="flex items-center justify-between">
                  <span className="text-muted-foreground">Team &amp; roles</span>
                  <Tag tone={ent.team_enabled ? "success" : "neutral"}>
                    {ent.team_enabled ? "Included" : "Chamber plan only"}
                  </Tag>
                </li>
                <li className="flex items-center justify-between">
                  <span className="text-muted-foreground">Matters</span>
                  <span className="font-medium">{ent.matters_limit ?? "Unlimited"}</span>
                </li>
                <li className="flex items-center justify-between">
                  <span className="text-muted-foreground">Storage</span>
                  <span className="font-medium">
                    {ent.storage_limit_mb === null ? "Unlimited" : `${ent.storage_limit_mb} MB`}
                  </span>
                </li>
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
            )}
          </section>

          <section className="surface-panel rounded p-5">
            <h2 className="flex items-center gap-2 font-display text-sm font-bold">
              <MessageCircle className="size-4" />
              WhatsApp integration
            </h2>
            <p className="mt-2 text-xs text-muted-foreground">
              {ent?.whatsapp_enabled
                ? "This is a licensing entitlement only — no WhatsApp Business API provider is connected yet, so no messages can be sent."
                : ent?.ocr_enabled === false
                  ? "WhatsApp is part of the Solo Pro and Chamber plans."
                  : "Your plan includes WhatsApp — ask the platform admin to switch it on for your chamber."}
            </p>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
