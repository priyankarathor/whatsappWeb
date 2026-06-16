"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Clock3,
  LifeBuoy,
  Lock,
  LogOut,
  MessageSquare,
  Moon,
  Palette,
  RefreshCcw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Sun,
  Ticket,
  Trash2,
  User,
  X,
} from "lucide-react";
import API from "../utils/api";
import { disconnectSocket } from "../lib/socket";

const MENU = [
  { id: "profile", label: "Profile", hint: "Name, email and phone", icon: User },
  { id: "security", label: "Security", hint: "Change password", icon: Lock },
  { id: "appearance", label: "Appearance", hint: "Light and dark mode", icon: Palette },
  { id: "support", label: "Support", hint: "Raise an issue", icon: LifeBuoy },
  { id: "approvals", label: "Approvals", hint: "Profile change requests", icon: ShieldCheck },
];

const ISSUE_CATEGORIES = [
  { id: "forgot_password", label: "Forgot password", priority: "high", reply: "I will send your registered email and phone to support so an admin or manager can verify and reset your password." },
  { id: "login", label: "Login issue", priority: "high", reply: "I will create a login ticket. Support will check your account, email, phone, and the login error." },
  { id: "messages", label: "Messages not sending", priority: "medium", reply: "I will create a message-delivery ticket. Support will check the contact number and message flow." },
  { id: "calls", label: "Call not connecting", priority: "high", reply: "I will create a call ticket. Support will check browser/network details and WebRTC connection status." },
  { id: "billing", label: "Billing or plan", priority: "medium", reply: "I will create a billing ticket. Support will review your plan or invoice details." },
  { id: "other", label: "Other issue", priority: "medium", reply: "Tell me what happened and I will create a support ticket for the team." },
];

const emptyProfile = {
  name: "",
  email: "",
  phone: "",
  role: "user",
};

const roleLabel = (role) => (role === "super_admin" ? "Admin" : role || "User");
const canSaveDirectly = (role) => role === "super_admin";
const initials = (name = "") => (name.trim().charAt(0) || "U").toUpperCase();
const normalizeTheme = (value) => (value === "dark" ? "dark" : "light");
const syncThemePreference = (nextTheme, persist = true) => {
  const safeTheme = normalizeTheme(nextTheme);

  if (typeof window === "undefined") return safeTheme;

  if (persist) window.localStorage.setItem("settingsTheme", safeTheme);
  document.documentElement.dataset.theme = safeTheme;
  document.body.dataset.theme = safeTheme;
  window.dispatchEvent(new CustomEvent("settingsThemeChanged", { detail: safeTheme }));

  return safeTheme;
};

function Pill({ children, tone = "neutral" }) {
  const tones = {
    neutral: { bg: "#eef2f7", color: "#475569" },
    pending: { bg: "#fff7ed", color: "#c2410c" },
    approved: { bg: "#dcfce7", color: "#166534" },
    rejected: { bg: "#fee2e2", color: "#b91c1c" },
    admin: { bg: "#dbeafe", color: "#1d4ed8" },
  };
  const s = tones[tone] || tones.neutral;
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      borderRadius: 999,
      padding: "3px 9px",
      background: s.bg,
      color: s.color,
      fontSize: 12,
      fontWeight: 700,
      textTransform: "capitalize",
    }}>
      {children}
    </span>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      style={{
        width: 46,
        height: 26,
        border: "none",
        borderRadius: 999,
        background: checked ? "#0f766e" : "#cbd5e1",
        padding: 3,
        cursor: "pointer",
      }}
    >
      <span style={{
        display: "block",
        width: 20,
        height: 20,
        borderRadius: "50%",
        background: "#fff",
        transform: checked ? "translateX(20px)" : "translateX(0)",
        transition: "transform 160ms ease",
        boxShadow: "0 1px 4px rgba(15,23,42,0.22)",
      }} />
    </button>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const chatEndRef = useRef(null);

  const [active, setActive] = useState("profile");
  const [search, setSearch] = useState("");
  const [theme, setTheme] = useState("light");
  const [themeReady, setThemeReady] = useState(false);
  const [profile, setProfile] = useState(emptyProfile);
  const [draft, setDraft] = useState(emptyProfile);
  const [requests, setRequests] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [chat, setChat] = useState([]);
  const [supportOpen] = useState(false);
  const [ticketsModalOpen, setTicketsModalOpen] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [supportInput, setSupportInput] = useState("");
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [replyDrafts, setReplyDrafts] = useState({});
  const [resetDrafts, setResetDrafts] = useState({});
  const [replyStatusDrafts, setReplyStatusDrafts] = useState({});

  const isDark = theme === "dark";
  const admin = canSaveDirectly(profile.role);
  const supportStaff = ["super_admin", "manager"].includes(profile.role);
  const hasChanges = JSON.stringify({
    name: draft.name,
    email: draft.email,
    phone: draft.phone,
  }) !== JSON.stringify({
    name: profile.name,
    email: profile.email,
    phone: profile.phone,
  });

  const colors = {
    page: "var(--card-bg)",
    panel: "var(--card-bg)",
    panel2: "var(--app-surface-2)",
    text: "var(--app-text)",
    muted: "var(--app-text-muted)",
    border: "var(--app-border)",
    accent: "#00a884",
    accentSoft: isDark ? "rgba(0, 168, 132, 0.22)" : "#ccfbf1",
    danger: "#ef4444",
    input: "var(--input-bg)",
  };

  const filteredMenu = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return MENU;
    return MENU.filter((item) =>
      item.label.toLowerCase().includes(q) || item.hint.toLowerCase().includes(q)
    );
  }, [search]);

  const pendingCount = requests.filter((r) => r.status === "pending").length;
  const profileId = (profile._id || profile.id || "").toString();

  const getTicketUserId = (ticket) => (
    ticket?.user?._id || ticket?.user?.id || ticket?.user || ""
  ).toString();

  const myTickets = useMemo(
    () => tickets.filter((ticket) => profileId && getTicketUserId(ticket) === profileId),
    [tickets, profileId]
  );

  const activeMyTickets = useMemo(
    () => myTickets.filter((ticket) => ticket.status !== "ended"),
    [myTickets]
  );
  const activeUserTicket = useMemo(
    () => [...activeMyTickets].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null,
    [activeMyTickets]
  );
  const activeTickets = tickets.filter((ticket) => ticket.status !== "ended");
  const endedTickets = tickets.filter((ticket) => ticket.status === "ended");
  const visibleSupportTickets = supportStaff ? tickets : activeMyTickets;
  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket._id === selectedTicketId) || null,
    [tickets, selectedTicketId]
  );

  const latestStaffReplyTime = useMemo(() => {
    if (supportStaff) return 0;
    return activeMyTickets.reduce((latest, ticket) => {
      const ticketUserId = getTicketUserId(ticket);
      const replyTimes = (ticket.replies || [])
        .filter((reply) => {
          const senderId = (reply.sender?._id || reply.sender?.id || reply.sender || "").toString();
          return senderId && senderId !== ticketUserId;
        })
        .map((reply) => new Date(reply.createdAt || 0).getTime());
      return Math.max(latest, 0, ...replyTimes);
    }, 0);
  }, [activeMyTickets, supportStaff]);

  const [lastSeenSupportReplyAt, setLastSeenSupportReplyAt] = useState(0);
  const supportUnreadCount = useMemo(() => {
    if (supportStaff) return 0;
    return activeMyTickets.reduce((count, ticket) => {
      const ticketUserId = getTicketUserId(ticket);
      return count + (ticket.replies || []).filter((reply) => {
        const senderId = (reply.sender?._id || reply.sender?.id || reply.sender || "").toString();
        return senderId && senderId !== ticketUserId && new Date(reply.createdAt || 0).getTime() > lastSeenSupportReplyAt;
      }).length;
    }, 0);
  }, [activeMyTickets, lastSeenSupportReplyAt, supportStaff]);

  const supportChat = useMemo(() => {
    const introName = profile.name?.trim() || profile.email || "there";
    const messages = [
      {
        by: "bot",
        text: `Hi ${introName}, you are chatting with Customer Support AI. Pick an issue below or type your question.`,
      },
    ];

    [...activeMyTickets]
      .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
      .forEach((ticket) => {
        messages.push({
          by: "user",
          text: ticket.subject,
          meta: new Date(ticket.createdAt).toLocaleString(),
        });
        if (ticket.message && ticket.message !== ticket.subject) {
          messages.push({
            by: "user",
            text: ticket.message,
            meta: new Date(ticket.createdAt).toLocaleString(),
          });
        }
        messages.push({
          by: "bot",
          text: `Ticket created: ${ticket.status?.replace("_", " ") || "open"}. Support will reply here when it is reviewed.`,
          meta: ticket.category,
        });

        [...(ticket.replies || [])]
          .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
          .forEach((reply) => {
            const senderId = (reply.sender?._id || reply.sender?.id || reply.sender || "").toString();
            messages.push({
              by: senderId && senderId === profileId ? "user" : "bot",
              text: reply.message,
              meta: `${reply.sender?.name || roleLabel(reply.senderRole)} - ${new Date(reply.createdAt).toLocaleString()}`,
            });
          });
      });

    return [...messages, ...chat];
  }, [activeMyTickets, chat, profile.email, profile.name, profileId]);

  const refreshSupportTickets = useCallback(async () => {
    try {
      const res = await API.get("/users/support-tickets");
      setTickets(res.data?.data || []);
    } catch (error) {
      setNotice({ type: "error", text: error.response?.data?.error || "Could not refresh support tickets." });
    }
  }, []);

  useEffect(() => {
    const savedTheme = normalizeTheme(localStorage.getItem("settingsTheme"));
    syncThemePreference(savedTheme, false);
    setTheme(savedTheme);
    setThemeReady(true);
    setLastSeenSupportReplyAt(Number(localStorage.getItem("supportLastSeenReplyAt") || 0));
  }, []);

  useEffect(() => {
    if (!themeReady) return;

    const safeTheme = syncThemePreference(theme);
    if (safeTheme !== theme) setTheme(safeTheme);
  }, [theme, themeReady]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [supportChat, supportOpen]);

  useEffect(() => {
    if (!supportOpen || !latestStaffReplyTime) return;
    setLastSeenSupportReplyAt(latestStaffReplyTime);
    localStorage.setItem("supportLastSeenReplyAt", String(latestStaffReplyTime));
  }, [latestStaffReplyTime, supportOpen]);

  useEffect(() => {
    if (supportStaff) return undefined;

    refreshSupportTickets();
    const timer = window.setInterval(refreshSupportTickets, 8000);
    return () => window.clearInterval(timer);
  }, [refreshSupportTickets, supportStaff]);

  useEffect(() => {
    if (!supportStaff || (active !== "support" && !supportOpen && !ticketsModalOpen)) return undefined;

    refreshSupportTickets();
    const timer = window.setInterval(refreshSupportTickets, 8000);
    return () => window.clearInterval(timer);
  }, [active, refreshSupportTickets, supportOpen, supportStaff, ticketsModalOpen]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [meRes, requestsRes, ticketsRes] = await Promise.all([
          API.get("/users/me"),
          API.get("/users/profile-change-requests"),
          API.get("/users/support-tickets"),
        ]);

        if (cancelled) return;

        const me = meRes.data?.data || emptyProfile;
        setProfile(me);
        setDraft(me);
        setRequests(requestsRes.data?.data || []);
        setTickets(ticketsRes.data?.data || []);

        const storedUser = JSON.parse(localStorage.getItem("user") || "{}");
        localStorage.setItem("user", JSON.stringify({ ...storedUser, ...me, id: me._id || me.id || storedUser.id }));
        window.dispatchEvent(new Event("loginStatusChanged"));
      } catch (error) {
        if (!cancelled) {
          setNotice({ type: "error", text: error.response?.data?.error || "Could not load settings." });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, []);

  const fieldStyle = {
    width: "100%",
    minHeight: 42,
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    background: colors.input,
    color: colors.text,
    padding: "9px 11px",
    fontSize: 14,
    outline: "none",
  };

  const buttonBase = {
    border: "none",
    borderRadius: 8,
    minHeight: 38,
    padding: "0 13px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  };

  const saveProfile = async () => {
    if (!hasChanges || saving) return;
    setSaving(true);
    setNotice(null);

    try {
      const res = await API.patch("/users/me", {
        name: draft.name,
        email: draft.email,
        phone: draft.phone,
      });

      if (res.data?.status === "pending") {
        const requestsRes = await API.get("/users/profile-change-requests");
        setRequests(requestsRes.data?.data || []);
        setDraft(profile);
        setNotice({ type: "success", text: "Changes sent to admin for approval." });
      } else {
        const next = res.data?.data || draft;
        setProfile(next);
        setDraft(next);
        const storedUser = JSON.parse(localStorage.getItem("user") || "{}");
        localStorage.setItem("user", JSON.stringify({ ...storedUser, ...next, id: next._id || next.id || storedUser.id }));
        window.dispatchEvent(new Event("loginStatusChanged"));
        setNotice({ type: "success", text: "Profile updated." });
      }
    } catch (error) {
      setNotice({ type: "error", text: error.response?.data?.error || "Could not save profile." });
    } finally {
      setSaving(false);
    }
  };

  const reviewRequest = async (id, status) => {
    try {
      const res = await API.patch(`/users/profile-change-requests/${id}`, { status });
      setRequests((prev) => prev.map((req) => req._id === id ? res.data.data : req));
      setNotice({ type: "success", text: `Request ${status}.` });
    } catch (error) {
      setNotice({ type: "error", text: error.response?.data?.error || "Could not review request." });
    }
  };

  const changePassword = async () => {
    if (!passwordForm.currentPassword || !passwordForm.newPassword) {
      setNotice({ type: "error", text: "Enter current password and new password." });
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setNotice({ type: "error", text: "New password and confirmation do not match." });
      return;
    }

    try {
      await API.patch("/users/me/password", {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setNotice({ type: "success", text: "Password updated." });
    } catch (error) {
      setNotice({ type: "error", text: error.response?.data?.error || "Could not update password." });
    }
  };

  const buildIssueMessage = (issue, typedMessage = "") => {
    const accountLines = [
      profile.name ? `Name: ${profile.name}` : "",
      profile.email ? `Email: ${profile.email}` : "Email: not set",
      profile.phone ? `Phone: ${profile.phone}` : "Phone: not set",
    ].filter(Boolean);

    return [
      typedMessage || issue.reply,
      "",
      "Account details:",
      ...accountLines,
    ].join("\n");
  };

  const createSupportTicket = async ({ issue, typedMessage = "" }) => {
    if (creatingTicket) return;

    if (activeUserTicket) {
      const replyText = typedMessage || issue.label;
      await replyToActiveTicket(replyText);
      return;
    }

    const subject = typedMessage
      ? typedMessage.slice(0, 70)
      : issue.label;
    const message = buildIssueMessage(issue, typedMessage);

    window.dispatchEvent(new Event("openSupportChat"));
    setCreatingTicket(true);
    setChat((prev) => [
      ...prev,
      { by: "user", text: typedMessage || issue.label },
      { by: "bot", text: "Creating your ticket now..." },
    ]);

    try {
      const res = await API.post("/users/support-tickets", {
        category: issue.id,
        subject,
        message,
        priority: issue.priority || "medium",
      });
      const created = res.data.data;
      setTickets((prev) => [created, ...prev.filter((ticket) => ticket._id !== created._id)]);
      setChat([]);
      setSupportInput("");
      setNotice({ type: "success", text: "Support ticket created. Replies will appear in the chatbot." });
    } catch (error) {
      const activeTicket = error.response?.data?.activeTicket;
      if (activeTicket) {
        setTickets((prev) => [activeTicket, ...prev.filter((ticket) => ticket._id !== activeTicket._id)]);
        setChat([]);
        setNotice({ type: "error", text: "You already have an active ticket. Continue in the current chat." });
        return;
      }
      setChat((prev) => [
        ...prev,   
        { by: "bot", text: error.response?.data?.error || "I could not create the ticket. Please try again." },
      ]);
      setNotice({ type: "error", text: error.response?.data?.error || "Could not create ticket." });
    } finally {
      setCreatingTicket(false);
    }
  };

  const chooseIssue = (issue) => createSupportTicket({ issue });

  async function replyToActiveTicket(message) {
    const text = message.trim();
    if (!text || !activeUserTicket || creatingTicket) return;

    setCreatingTicket(true);
    setChat((prev) => [
      ...prev,
      { by: "user", text },
      { by: "bot", text: "Adding your reply to the current ticket..." },
    ]);

    try {
      const res = await API.post(`/users/support-tickets/${activeUserTicket._id}/user-replies`, { message: text });
      setTickets((prev) => prev.map((ticket) => ticket._id === activeUserTicket._id ? res.data.data : ticket));
      setSupportInput("");
      setChat([]);
    } catch (error) {
      setChat((prev) => [
        ...prev,
        { by: "bot", text: error.response?.data?.error || "I could not add your reply. Please try again." },
      ]);
      setNotice({ type: "error", text: error.response?.data?.error || "Could not add reply." });
    } finally {
      setCreatingTicket(false);
    }
  }

  const sendSupportInput = () => {
    const typedMessage = supportInput.trim();
    if (!typedMessage) return;
    if (activeUserTicket) {
      replyToActiveTicket(typedMessage);
      return;
    }
    const issue = ISSUE_CATEGORIES.find((item) => item.id === "other") || ISSUE_CATEGORIES[0];
    createSupportTicket({ issue, typedMessage });
  };

  const replyToTicket = async (ticketId, statusOverride) => {
    const message = replyDrafts[ticketId]?.trim() || (statusOverride === "resolved" ? "Your ticket has been marked as resolved." : "");
    if (!message) {
      setNotice({ type: "error", text: "Write a reply first." });
      return;
    }

    try {
      const res = await API.post(`/users/support-tickets/${ticketId}/replies`, {
        message,
        status: statusOverride || replyStatusDrafts[ticketId] || "in_progress",
      });
      setTickets((prev) => prev.map((ticket) => ticket._id === ticketId ? res.data.data : ticket));
      setReplyDrafts((prev) => ({ ...prev, [ticketId]: "" }));
      setReplyStatusDrafts((prev) => ({ ...prev, [ticketId]: "" }));
      setNotice({ type: "success", text: "Reply sent to user." });
    } catch (error) {
      setNotice({ type: "error", text: error.response?.data?.error || "Could not send reply." });
    }
  };

  const resetTicketPassword = async (ticketId) => {
    const temporaryPassword = resetDrafts[ticketId]?.trim();
    if (!temporaryPassword || temporaryPassword.length < 6) {
      setNotice({ type: "error", text: "Enter a temporary password with at least 6 characters." });
      return;
    }

    try {
      const res = await API.post(`/users/support-tickets/${ticketId}/reset-password`, {
        temporaryPassword,
      });
      setTickets((prev) => prev.map((ticket) => ticket._id === ticketId ? res.data.data : ticket));
      setResetDrafts((prev) => ({ ...prev, [ticketId]: "" }));
      setNotice({ type: "success", text: "Temporary password set. Share it through your approved secure channel." });
    } catch (error) {
      setNotice({ type: "error", text: error.response?.data?.error || "Could not reset password." });
    }
  };

  const endTicketChat = async (ticketId) => {
    if (!window.confirm("End this support chat for the user? Staff will still see it in ended tickets.")) return;
    try {
      const res = await API.patch(`/users/support-tickets/${ticketId}/end`);
      setTickets((prev) => prev.map((ticket) => ticket._id === ticketId ? res.data.data : ticket));
      setReplyDrafts((prev) => ({ ...prev, [ticketId]: "" }));
      setReplyStatusDrafts((prev) => ({ ...prev, [ticketId]: "" }));
      setNotice({ type: "success", text: "Chat ended. It is hidden from the user and kept for staff history." });
    } catch (error) {
      setNotice({ type: "error", text: error.response?.data?.error || "Could not end chat." });
    }
  };

  const deleteEndedTicket = async (ticketId) => {
    const ticket = tickets.find((item) => item._id === ticketId);
    if (ticket?.status !== "ended") {
      setNotice({ type: "error", text: "Only ended tickets can be deleted." });
      return;
    }
    if (!window.confirm("Delete this ended ticket permanently?")) return;

    try {
      await API.delete(`/users/support-tickets/${ticketId}`);
      setTickets((prev) => prev.filter((item) => item._id !== ticketId));
      setSelectedTicketId(null);
      setReplyDrafts((prev) => {
        const next = { ...prev };
        delete next[ticketId];
        return next;
      });
      setReplyStatusDrafts((prev) => {
        const next = { ...prev };
        delete next[ticketId];
        return next;
      });
      setResetDrafts((prev) => {
        const next = { ...prev };
        delete next[ticketId];
        return next;
      });
      setNotice({ type: "success", text: "Ended ticket deleted." });
    } catch (error) {
      setNotice({ type: "error", text: error.response?.data?.error || "Could not delete ticket." });
    }
  };

  const logout = () => {
    disconnectSocket();
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.dispatchEvent(new Event("loginStatusChanged"));
    router.push("/");
  };

  const renderProfile = () => (
    <section style={sectionStyle(colors)}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
        <div style={{
          width: 58,
          height: 58,
          borderRadius: "50%",
          background: colors.accentSoft,
          color: colors.accent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 25,
          fontWeight: 800,
        }}>
          {initials(draft.name || draft.email)}
        </div>
        <div>
          <h2 style={{ margin: 0, color: colors.text, fontSize: 18 }}>{draft.name || "Your profile"}</h2>
          <div style={{ color: colors.muted, fontSize: 13 }}>{draft.email || "No email set"}</div>
          <div style={{ marginTop: 6 }}><Pill tone={admin ? "admin" : "neutral"}>{roleLabel(profile.role)}</Pill></div>
        </div>
      </div>

      {!admin && (
        <div style={noticeBox(colors, "warning")}>
          <Clock3 size={16} />
          Managers and users can edit details, but changes are applied only after admin approval.
        </div>
      )}

      <div className="settings-grid">
        <label style={labelStyle(colors)}>Name<input style={fieldStyle} value={draft.name || ""} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} /></label>
        <label style={labelStyle(colors)}>Email<input style={fieldStyle} type="email" value={draft.email || ""} onChange={(e) => setDraft((p) => ({ ...p, email: e.target.value }))} /></label>
        <label style={labelStyle(colors)}>Phone<input style={fieldStyle} value={draft.phone || ""} onChange={(e) => setDraft((p) => ({ ...p, phone: e.target.value }))} /></label>
        <label style={labelStyle(colors)}>Role<input style={{ ...fieldStyle, opacity: 0.75 }} value={roleLabel(profile.role)} disabled /></label>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
        <button type="button" disabled={!hasChanges || saving} onClick={saveProfile} style={{
          ...buttonBase,
          background: hasChanges ? colors.accent : colors.panel2,
          color: hasChanges ? "#fff" : colors.muted,
        }}>
          <Save size={16} /> {admin ? "Save Details" : "Request Approval"}
        </button>
        <button type="button" disabled={!hasChanges || saving} onClick={() => setDraft(profile)} style={{
          ...buttonBase,
          background: colors.panel2,
          color: colors.text,
          border: `1px solid ${colors.border}`,
        }}>
          <RefreshCcw size={16} /> Reset
        </button>
      </div>
    </section>
  );

  const renderAppearance = () => (
    <section style={sectionStyle(colors)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14 }}>
        <div>
          <h2 style={headingStyle(colors)}>Theme</h2>
          <p style={subTextStyle(colors)}>Switch the settings workspace between light and dark mode.</p>
        </div>
        <Toggle checked={isDark} onChange={(checked) => setTheme(checked ? "dark" : "light")} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 18 }}>
        {[
          { id: "light", label: "Light", icon: Sun },
          { id: "dark", label: "Dark", icon: Moon },
        ].map((item) => {
          const Icon = item.icon;
          const selected = theme === item.id;
          return (
            <button key={item.id} type="button" onClick={() => setTheme(item.id)} style={{
              border: `1px solid ${selected ? colors.accent : colors.border}`,
              borderRadius: 8,
              background: selected ? colors.accentSoft : colors.panel2,
              color: selected ? colors.accent : colors.text,
              padding: 16,
              minHeight: 86,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              gap: 8,
              fontWeight: 800,
            }}>
              <Icon size={22} />
              {item.label}
            </button>
          );
        })}
      </div>
    </section>
  );

  const renderSecurity = () => (
    <section style={sectionStyle(colors)}>
      <h2 style={headingStyle(colors)}>Change Password</h2>
      <p style={subTextStyle(colors)}>Use your current password to set a new login password.</p>
      <div className="settings-grid" style={{ marginTop: 18 }}>
        <label style={labelStyle(colors)}>Current Password
          <input
            style={fieldStyle}
            type="password"
            value={passwordForm.currentPassword}
            onChange={(e) => setPasswordForm((p) => ({ ...p, currentPassword: e.target.value }))}
          />
        </label>
        <label style={labelStyle(colors)}>New Password
          <input
            style={fieldStyle}
            type="password"
            value={passwordForm.newPassword}
            onChange={(e) => setPasswordForm((p) => ({ ...p, newPassword: e.target.value }))}
          />
        </label>
        <label style={labelStyle(colors)}>Confirm New Password
          <input
            style={fieldStyle}
            type="password"
            value={passwordForm.confirmPassword}
            onChange={(e) => setPasswordForm((p) => ({ ...p, confirmPassword: e.target.value }))}
          />
        </label>
      </div>
      <button type="button" onClick={changePassword} style={{ ...buttonBase, background: colors.accent, color: "#fff", marginTop: 18 }}>
        <Lock size={16} /> Update Password
      </button>
      <button
        type="button"
        onClick={() => {
          setActive("support");
          const issue = ISSUE_CATEGORIES.find((item) => item.id === "forgot_password");
          if (issue) chooseIssue(issue);
        }}
        style={{ ...buttonBase, background: colors.panel2, color: colors.text, border: `1px solid ${colors.border}`, marginTop: 18, marginLeft: 10 }}
      >
        Forgot Password
      </button>
    </section>
  );

  const renderSupportLegacy = () => (
    <section style={sectionStyle(colors)}>
      <h2 style={headingStyle(colors)}>Support Assistant</h2>
      <p style={subTextStyle(colors)}>
        Choose a common issue, raise a ticket, and review replies from the support team.
      </p>

      <div className="support-layout">
        <div style={{
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          overflow: "hidden",
          minHeight: 390,
          display: "flex",
          flexDirection: "column",
          background: colors.panel2,
        }}>
          <div style={{ padding: 12, background: colors.accent, color: "#fff", display: "flex", alignItems: "center", gap: 8, fontWeight: 800 }}>
            <Bot size={18} /> Customer Care
          </div>
          <div style={{ flex: 1, padding: 12, overflowY: "auto", display: "flex", flexDirection: "column", gap: 9 }}>
            {chat.map((msg, index) => (
              <div key={`${msg.by}-${index}`} style={{ display: "flex", justifyContent: msg.by === "user" ? "flex-end" : "flex-start" }}>
                <div style={{
                  maxWidth: "82%",
                  borderRadius: msg.by === "user" ? "12px 12px 3px 12px" : "12px 12px 12px 3px",
                  background: msg.by === "user" ? colors.accentSoft : colors.panel,
                  color: msg.by === "user" ? colors.accent : colors.text,
                  border: `1px solid ${colors.border}`,
                  padding: "8px 10px",
                  fontSize: 13,
                  lineHeight: 1.45,
                }}>
                  {msg.text}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div style={{ padding: 10, display: "flex", gap: 8, flexWrap: "wrap", borderTop: `1px solid ${colors.border}` }}>
            {ISSUE_CATEGORIES.map((issue) => (
              <button key={issue.id} type="button" onClick={() => chooseIssue(issue)} style={{
                border: `1px solid ${colors.border}`,
                background: colors.panel,
                color: colors.text,
                borderRadius: 999,
                padding: "6px 10px",
                fontSize: 12,
                cursor: "pointer",
              }}>
                {issue.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <label style={labelStyle(colors)}>Category
            <select style={fieldStyle} value={ticketForm.category} onChange={(e) => setTicketForm((p) => ({ ...p, category: e.target.value }))}>
              {ISSUE_CATEGORIES.map((issue) => <option key={issue.id} value={issue.id}>{issue.label}</option>)}
            </select>
          </label>
          <label style={labelStyle(colors)}>Subject
            <input style={fieldStyle} value={ticketForm.subject} onChange={(e) => setTicketForm((p) => ({ ...p, subject: e.target.value }))} placeholder="Short issue title" />
          </label>
          <label style={labelStyle(colors)}>Priority
            <select style={fieldStyle} value={ticketForm.priority} onChange={(e) => setTicketForm((p) => ({ ...p, priority: e.target.value }))}>
              {SUPPORT_PRIORITY.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label style={labelStyle(colors)}>Issue Details
            <textarea style={{ ...fieldStyle, minHeight: 128, resize: "vertical" }} value={ticketForm.message} onChange={(e) => setTicketForm((p) => ({ ...p, message: e.target.value }))} placeholder="Describe what happened" />
          </label>
          <button type="button" onClick={submitTicket} style={{ ...buttonBase, background: colors.accent, color: "#fff" }}>
            <Send size={16} /> Raise Ticket
          </button>
        </div>
      </div>

      {tickets.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <h3 style={{ ...headingStyle(colors), fontSize: 15 }}>{supportStaff ? "Raised Tickets" : "Recent Tickets"}</h3>
          <div style={{ display: "grid", gap: 8 }}>
            {tickets.map((ticket) => (
              <div key={ticket._id} style={{ ...rowCardStyle(colors, true), display: "block" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <Ticket size={17} color={colors.accent} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: colors.text, fontWeight: 800, fontSize: 14 }}>{ticket.subject}</div>
                    <div style={{ color: colors.muted, fontSize: 12 }}>
                      {supportStaff && `${ticket.user?.name || ticket.user?.phone || "User"} · `}
                      {ticket.category} · {new Date(ticket.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <Pill tone={ticket.status === "open" ? "pending" : "approved"}>{ticket.status?.replace("_", " ")}</Pill>
                </div>
                <div style={{ color: colors.text, fontSize: 13, marginTop: 10, lineHeight: 1.5 }}>{ticket.message}</div>

                {ticket.replies?.length > 0 && (
                  <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                    {ticket.replies.map((reply) => (
                      <div key={reply._id || reply.createdAt} style={{
                        border: `1px solid ${colors.border}`,
                        borderRadius: 8,
                        padding: 10,
                        background: colors.panel,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, color: colors.muted, fontSize: 12, marginBottom: 4 }}>
                          <MessageSquare size={13} />
                          {reply.sender?.name || roleLabel(reply.senderRole)} · {new Date(reply.createdAt).toLocaleString()}
                        </div>
                        <div style={{ color: colors.text, fontSize: 13 }}>{reply.message}</div>
                      </div>
                    ))}
                  </div>
                )}

                {supportStaff && (
                  <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <textarea
                        style={{ ...fieldStyle, minHeight: 74, resize: "vertical" }}
                        placeholder="Write a manual reply to the user"
                        value={replyDrafts[ticket._id] || ""}
                        onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [ticket._id]: e.target.value }))}
                      />
                      <button type="button" onClick={() => replyToTicket(ticket._id)} style={{ ...buttonBase, background: colors.accent, color: "#fff", minWidth: 92 }}>
                        <Send size={15} /> Reply
                      </button>
                    </div>
                    {ticket.category === "forgot_password" && (
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          style={fieldStyle}
                          type="password"
                          placeholder="Set temporary password"
                          value={resetDrafts[ticket._id] || ""}
                          onChange={(e) => setResetDrafts((prev) => ({ ...prev, [ticket._id]: e.target.value }))}
                        />
                        <button type="button" onClick={() => resetTicketPassword(ticket._id)} style={{ ...buttonBase, background: "#f59e0b", color: "#111827", minWidth: 142 }}>
                          Reset Password
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {tickets.length === 0 && supportStaff && (
        <div style={emptyStateStyle(colors)}>
          <Ticket size={28} />
          No support tickets yet.
        </div>
      )}
    </section>
  );

  const renderSupportWidget = () => null;

  const getTicketIssueLabel = (ticket) =>
    ISSUE_CATEGORIES.find((item) => item.id === ticket.category)?.label || ticket.category || "Support";

  const getTicketTone = (ticket) =>
    ticket.status === "ended" ? "neutral" : ticket.status === "resolved" ? "approved" : ticket.status === "open" ? "pending" : "neutral";

  const renderTicketSummary = (ticket) => {
    const issueLabel = getTicketIssueLabel(ticket);
    const isEnded = ticket.status === "ended";
    const isSelected = selectedTicketId === ticket._id;

    return (
      <div
        key={ticket._id}
        role="button"
        tabIndex={0}
        onClick={() => setSelectedTicketId(ticket._id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setSelectedTicketId(ticket._id);
          }
        }}
        style={{
          ...rowCardStyle(colors, true),
          width: "100%",
          textAlign: "left",
          alignItems: "flex-start",
          background: isSelected ? colors.accentSoft : colors.panel,
          borderColor: isSelected ? colors.accent : colors.border,
          cursor: "pointer",
        }}
      >
        <Ticket size={17} color={isEnded ? colors.muted : colors.accent} style={{ marginTop: 2, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
            <div style={{ color: colors.text, fontWeight: 850, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {ticket.user?.name || ticket.user?.phone || "User"}
            </div>
            <Pill tone={getTicketTone(ticket)}>{ticket.status?.replace("_", " ")}</Pill>
          </div>
          <div style={{ color: colors.text, fontSize: 13, marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {ticket.subject || issueLabel}
          </div>
          <div style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
            {issueLabel} - {new Date(ticket.createdAt).toLocaleString()}
          </div>
        </div>
        {isEnded && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              deleteEndedTicket(ticket._id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                deleteEndedTicket(ticket._id);
              }
            }}
            title="Delete ended ticket"
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#fee2e2",
              color: "#b91c1c",
              flexShrink: 0,
            }}
          >
            <Trash2 size={15} />
          </span>
        )}
      </div>
    );
  };

  const renderStaffTicketCard = (ticket) => {
    if (!ticket) {
      return (
        <div style={{ ...emptyStateStyle(colors), minHeight: 340 }}>
          <Ticket size={28} />
          Select a ticket to view details and reply.
        </div>
      );
    }

    const issueLabel = ISSUE_CATEGORIES.find((item) => item.id === ticket.category)?.label || ticket.category || "Support";
    const statusValue = replyStatusDrafts[ticket._id] || (ticket.status === "open" ? "in_progress" : ticket.status || "in_progress");
    const isEnded = ticket.status === "ended";

    return (
      <div key={ticket._id} style={{ ...rowCardStyle(colors, true), display: "block", background: colors.panel }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <Ticket size={17} color={isEnded ? colors.muted : colors.accent} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: colors.text, fontWeight: 850, fontSize: 14 }}>{ticket.subject}</div>
            <div style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>
              {ticket.user?.name || ticket.user?.phone || "User"} - {issueLabel} - {new Date(ticket.createdAt).toLocaleString()}
            </div>
            {isEnded && (
              <div style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>
                Ended {ticket.endedAt ? new Date(ticket.endedAt).toLocaleString() : ""}{ticket.endedBy?.name ? ` by ${ticket.endedBy.name}` : ""}
              </div>
            )}
          </div>
          <Pill tone={isEnded ? "neutral" : ticket.status === "resolved" ? "approved" : ticket.status === "open" ? "pending" : "neutral"}>
            {ticket.status?.replace("_", " ")}
          </Pill>
          {isEnded && (
            <button type="button" onClick={() => deleteEndedTicket(ticket._id)} style={{ ...buttonBase, background: "#fee2e2", color: "#b91c1c", minHeight: 34 }}>
              <Trash2 size={15} /> Delete
            </button>
          )}
        </div>

        <div style={{ color: colors.text, fontSize: 13, marginTop: 10, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
          {ticket.message}
        </div>

        {ticket.replies?.length > 0 && (
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {ticket.replies.map((reply) => (
              <div key={reply._id || reply.createdAt} style={{
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                padding: 10,
                background: colors.panel2,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: colors.muted, fontSize: 12, marginBottom: 4 }}>
                  <MessageSquare size={13} />
                  {reply.sender?.name || roleLabel(reply.senderRole)} - {new Date(reply.createdAt).toLocaleString()}
                </div>
                <div style={{ color: colors.text, fontSize: 13, whiteSpace: "pre-wrap" }}>{reply.message}</div>
              </div>
            ))}
          </div>
        )}

        {!isEnded && (
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <textarea
              style={{ ...fieldStyle, minHeight: 82, resize: "vertical" }}
              placeholder="Reply to the user. This appears in their chatbot."
              value={replyDrafts[ticket._id] || ""}
              onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [ticket._id]: e.target.value }))}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={statusValue}
                onChange={(e) => setReplyStatusDrafts((prev) => ({ ...prev, [ticket._id]: e.target.value }))}
                style={{ ...fieldStyle, maxWidth: 170 }}
              >
                <option value="in_progress">In progress</option>
                <option value="resolved">Resolved</option>
                <option value="open">Open</option>
              </select>
              <button type="button" onClick={() => replyToTicket(ticket._id)} style={{ ...buttonBase, background: colors.accent, color: "#fff" }}>
                <Send size={15} /> Send Reply
              </button>
              <button type="button" onClick={() => replyToTicket(ticket._id, "resolved")} style={{ ...buttonBase, background: "#dcfce7", color: "#166534" }}>
                <Check size={15} /> Solve
              </button>
              <button type="button" onClick={() => endTicketChat(ticket._id)} style={{ ...buttonBase, background: "#fee2e2", color: "#b91c1c" }}>
                <X size={15} /> End Chat
              </button>
            </div>
            {ticket.category === "forgot_password" && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  style={{ ...fieldStyle, maxWidth: 260 }}
                  type="password"
                  placeholder="Temporary password"
                  value={resetDrafts[ticket._id] || ""}
                  onChange={(e) => setResetDrafts((prev) => ({ ...prev, [ticket._id]: e.target.value }))}
                />
                <button type="button" onClick={() => resetTicketPassword(ticket._id)} style={{ ...buttonBase, background: "#f59e0b", color: "#111827" }}>
                  Reset Password
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderTicketsModal = () => (
    ticketsModalOpen && (
      <div onClick={() => setTicketsModalOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", animation: "appModalBackdropIn 0.32s ease-out both", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: "min(1100px, 100%)", maxHeight: "88vh", background: colors.panel, border: `1px solid ${colors.border}`, borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 28px 80px rgba(0,0,0,0.32)", animation: "appModalCardIn 0.32s cubic-bezier(0.22, 1, 0.36, 1) both" }}>
          <div style={{ padding: "16px 18px", borderBottom: `1px solid ${colors.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ color: colors.text, fontSize: 18, fontWeight: 900 }}>Raised Tickets</div>
              <div style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>Compact list: user, issue, status. Open a ticket to reply, solve, end, or delete ended tickets.</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => router.push("/Settings/support-tickets")} style={{ ...buttonBase, background: colors.accent, color: "#fff" }}>
                <ExternalLink size={15} /> Full Page
              </button>
              <button type="button" onClick={refreshSupportTickets} style={{ ...buttonBase, background: colors.panel2, color: colors.text, border: `1px solid ${colors.border}` }}>
                <RefreshCcw size={15} /> Refresh
              </button>
              <button type="button" onClick={() => setTicketsModalOpen(false)} style={iconButtonStyle(colors)}>
                <X size={18} />
              </button>
            </div>
          </div>
          <div className="support-ticket-desk" style={{ flex: "1 1 auto", minHeight: 0, height: "calc(88vh - 73px)", overflow: "hidden", display: "grid", gridTemplateColumns: "minmax(280px, 0.42fr) minmax(0, 0.58fr)", alignItems: "stretch" }}>
            {tickets.length === 0 ? (
              <div style={{ ...emptyStateStyle(colors), gridColumn: "1 / -1", margin: 16 }}>
                <Ticket size={28} />
                No raised tickets yet.
              </div>
            ) : (
              <>
                <div style={{ borderRight: `1px solid ${colors.border}`, minHeight: 0, height: "100%", overflowY: "auto", overscrollBehavior: "contain", padding: 16, display: "grid", alignContent: "start", gap: 10 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <div style={{ color: colors.text, fontWeight: 900 }}>All tickets</div>
                    <Pill tone="pending">{activeTickets.length} active</Pill>
                    <Pill>{endedTickets.length} ended</Pill>
                  </div>
                  {activeTickets.map(renderTicketSummary)}
                  {endedTickets.length > 0 && (
                    <div style={{ color: colors.muted, fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 8 }}>Ended Tickets</div>
                  )}
                  {endedTickets.map(renderTicketSummary)}
                </div>
                <div className="support-ticket-detail-pane" style={{ minHeight: 0, height: "100%", overflowY: "auto", overscrollBehavior: "contain", padding: 16, alignSelf: "stretch" }}>
                  {renderStaffTicketCard(selectedTicket)}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    )
  );

  const renderSupport = () => (
    <section style={sectionStyle(colors)}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div>
          <h2 style={headingStyle(colors)}>Support Assistant</h2>
          <p style={subTextStyle(colors)}>
            Start a guided support chat. Each selected issue becomes a ticket for admins and managers.
          </p>
        </div>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
          <button type="button" onClick={() => window.dispatchEvent(new Event("openSupportChat"))} style={{ ...buttonBase, background: colors.accent, color: "#fff" }}>
            <MessageSquare size={16} /> Open Chat
          </button>
          {supportStaff && (
            <>
              <button type="button" onClick={() => setTicketsModalOpen(true)} style={{ ...buttonBase, background: colors.panel2, color: colors.text, border: `1px solid ${colors.border}` }}>
                <Ticket size={16} /> View Raised Tickets
              </button>
              <button type="button" onClick={() => router.push("/Settings/support-tickets")} style={{ ...buttonBase, background: colors.accent, color: "#fff" }}>
                <ExternalLink size={16} /> Open Full Page
              </button>
            </>
          )}
        </div>
      </div>

      <div className="support-layout">
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ ...rowCardStyle(colors, true), display: "block" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Bot size={20} color={colors.accent} />
              <div>
                <div style={{ color: colors.text, fontWeight: 850 }}>Predefined issue flow</div>
                <div style={{ color: colors.muted, fontSize: 13, marginTop: 3 }}>
                  Users tap an issue, the chatbot creates a ticket, and support replies come back into the chat.
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              {ISSUE_CATEGORIES.map((issue) => (
                <button
                  key={issue.id}
                  type="button"
                  onClick={() => chooseIssue(issue)}
                  disabled={creatingTicket}
                  style={{
                    ...buttonBase,
                    background: colors.panel,
                    color: colors.text,
                    border: `1px solid ${colors.border}`,
                    minHeight: 36,
                    opacity: creatingTicket ? 0.7 : 1,
                  }}
                >
                  {issue.label}
                </button>
              ))}
            </div>
          </div>

          {supportStaff ? (
            <div style={{ ...rowCardStyle(colors, true), display: "block" }}>
              <div style={{ color: colors.text, fontWeight: 850 }}>Raised tickets</div>
              <div style={{ color: colors.muted, fontSize: 13, marginTop: 5 }}>
                {activeTickets.length} active ticket{activeTickets.length === 1 ? "" : "s"} and {endedTickets.length} ended ticket{endedTickets.length === 1 ? "" : "s"}.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <button type="button" onClick={() => setTicketsModalOpen(true)} style={{ ...buttonBase, background: colors.accent, color: "#fff" }}>
                  <Ticket size={16} /> View Modal
                </button>
                <button type="button" onClick={() => router.push("/Settings/support-tickets")} style={{ ...buttonBase, background: colors.panel2, color: colors.text, border: `1px solid ${colors.border}` }}>
                  <ExternalLink size={16} /> Open Full Page
                </button>
              </div>
            </div>
          ) : (
            <div style={{ ...rowCardStyle(colors, true), display: "block" }}>
              <div style={{ color: colors.text, fontWeight: 850 }}>Your tickets</div>
              <div style={{ color: colors.muted, fontSize: 13, marginTop: 5 }}>
                {activeMyTickets.length ? `${activeMyTickets.length} ticket${activeMyTickets.length > 1 ? "s" : ""} linked to this account.` : "No tickets yet. Open the chat to start one."}
              </div>
            </div>
          )}
        </div>

        {!supportStaff && (
        <div style={{ ...rowCardStyle(colors, true), display: "block" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
            <div>
              <div style={{ color: colors.text, fontWeight: 850 }}>{supportStaff ? "Ticket Desk" : "Recent Activity"}</div>
              <div style={{ color: colors.muted, fontSize: 12 }}>
                {visibleSupportTickets.length} ticket{visibleSupportTickets.length === 1 ? "" : "s"}
              </div>
            </div>
            <button type="button" onClick={refreshSupportTickets} style={{ ...buttonBase, background: colors.panel, color: colors.text, border: `1px solid ${colors.border}` }}>
              <RefreshCcw size={15} /> Refresh
            </button>
          </div>

          {visibleSupportTickets.length === 0 ? (
            <div style={emptyStateStyle(colors)}>
              <Ticket size={28} />
              {supportStaff ? "No support tickets yet." : "No ticket activity yet."}
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10, maxHeight: supportStaff ? 640 : 360, overflowY: "auto", paddingRight: 4 }}>
              {visibleSupportTickets.map((ticket) => {
                const issueLabel = ISSUE_CATEGORIES.find((item) => item.id === ticket.category)?.label || ticket.category || "Support";
                const statusValue = replyStatusDrafts[ticket._id] || (ticket.status === "open" ? "in_progress" : ticket.status || "in_progress");
                return (
                  <div key={ticket._id} style={{ ...rowCardStyle(colors, true), display: "block", background: colors.panel }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <Ticket size={17} color={colors.accent} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: colors.text, fontWeight: 850, fontSize: 14 }}>{ticket.subject}</div>
                        <div style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>
                          {supportStaff && `${ticket.user?.name || ticket.user?.phone || "User"} - `}
                          {issueLabel} - {new Date(ticket.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <Pill tone={ticket.status === "resolved" ? "approved" : ticket.status === "open" ? "pending" : "neutral"}>
                        {ticket.status?.replace("_", " ")}
                      </Pill>
                    </div>

                    <div style={{ color: colors.text, fontSize: 13, marginTop: 10, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                      {ticket.message}
                    </div>

                    {ticket.replies?.length > 0 && (
                      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                        {ticket.replies.map((reply) => (
                          <div key={reply._id || reply.createdAt} style={{
                            border: `1px solid ${colors.border}`,
                            borderRadius: 8,
                            padding: 10,
                            background: colors.panel2,
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, color: colors.muted, fontSize: 12, marginBottom: 4 }}>
                              <MessageSquare size={13} />
                              {reply.sender?.name || roleLabel(reply.senderRole)} - {new Date(reply.createdAt).toLocaleString()}
                            </div>
                            <div style={{ color: colors.text, fontSize: 13, whiteSpace: "pre-wrap" }}>{reply.message}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {supportStaff && (
                      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                        <textarea
                          style={{ ...fieldStyle, minHeight: 82, resize: "vertical" }}
                          placeholder="Reply to the user. This appears in their chatbot."
                          value={replyDrafts[ticket._id] || ""}
                          onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [ticket._id]: e.target.value }))}
                        />
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <select
                            value={statusValue}
                            onChange={(e) => setReplyStatusDrafts((prev) => ({ ...prev, [ticket._id]: e.target.value }))}
                            style={{ ...fieldStyle, maxWidth: 170 }}
                          >
                            <option value="in_progress">In progress</option>
                            <option value="resolved">Resolved</option>
                            <option value="open">Open</option>
                          </select>
                          <button type="button" onClick={() => replyToTicket(ticket._id)} style={{ ...buttonBase, background: colors.accent, color: "#fff" }}>
                            <Send size={15} /> Send Reply
                          </button>
                          <button type="button" onClick={() => replyToTicket(ticket._id, "resolved")} style={{ ...buttonBase, background: "#dcfce7", color: "#166534" }}>
                            <Check size={15} /> Solve
                          </button>
                        </div>
                        {ticket.category === "forgot_password" && (
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <input
                              style={{ ...fieldStyle, maxWidth: 260 }}
                              type="password"
                              placeholder="Temporary password"
                              value={resetDrafts[ticket._id] || ""}
                              onChange={(e) => setResetDrafts((prev) => ({ ...prev, [ticket._id]: e.target.value }))}
                            />
                            <button type="button" onClick={() => resetTicketPassword(ticket._id)} style={{ ...buttonBase, background: "#f59e0b", color: "#111827" }}>
                              Reset Password
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}
      </div>

    </section>
  );

  const renderApprovals = () => (
    <section style={sectionStyle(colors)}>
      <h2 style={headingStyle(colors)}>{admin ? "Approval Queue" : "Your Requests"}</h2>
      <p style={subTextStyle(colors)}>
        {admin ? "Review user and manager profile changes." : "Track profile changes sent to admin."}
      </p>
      <div style={{ display: "grid", gap: 10 }}>
        {requests.length === 0 && (
          <div style={emptyStateStyle(colors)}>
            <CheckCircle2 size={28} />
            No profile change requests yet.
          </div>
        )}
        {requests.map((request) => (
          <div key={request._id} style={rowCardStyle(colors, true)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <strong style={{ color: colors.text }}>
                  {request.requester?.name || request.requester?.phone || "User"}
                </strong>
                <Pill tone={request.status}>{request.status}</Pill>
              </div>
              <div style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>
                {new Date(request.createdAt).toLocaleString()}
              </div>
              <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                {request.changes?.map((change) => (
                  <div key={`${request._id}-${change.field}`} style={{ color: colors.muted, fontSize: 13 }}>
                    <strong style={{ color: colors.text }}>{change.field}</strong>:{" "}
                    <span style={{ textDecoration: "line-through" }}>{String(change.from || "-")}</span>
                    {" -> "}
                    <span style={{ color: colors.accent, fontWeight: 800 }}>{String(change.to || "-")}</span>
                  </div>
                ))}
              </div>
            </div>
            {admin && request.status === "pending" && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={() => reviewRequest(request._id, "approved")} style={{ ...buttonBase, background: "#dcfce7", color: "#166534" }}>
                  <Check size={16} /> Approve
                </button>
                <button type="button" onClick={() => reviewRequest(request._id, "rejected")} style={{ ...buttonBase, background: "#fee2e2", color: "#b91c1c" }}>
                  <X size={16} /> Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );

  const content = {
    profile: renderProfile,
    security: renderSecurity,
    appearance: renderAppearance,
    support: renderSupport,
    approvals: renderApprovals,
  }[active];

  return (
    <div className="settings-page-shell" style={{ minHeight: "calc(100vh - 138px)", background: colors.page, borderRadius: 12, overflow: "hidden" }}>
      <style>{`
        .settings-shell { display: grid; grid-template-columns: 310px minmax(0, 1fr); min-height: calc(100vh - 138px); }
        .settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
        .support-layout { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.9fr); gap: 16px; margin-top: 18px; }
        .settings-page-shell { color: var(--app-text); }
        .settings-page-shell input,
        .settings-page-shell textarea,
        .settings-page-shell select {
          background: var(--input-bg) !important;
          color: var(--app-text) !important;
          border-color: var(--input-border) !important;
        }
        .support-chat-panel input::placeholder,
        .support-chat-panel textarea::placeholder { color: ${colors.muted}; }
        body[data-theme="dark"] .settings-page-shell {
          background: var(--card-bg) !important;
        }
        @media (max-width: 900px) {
          .settings-shell { grid-template-columns: 1fr; }
          .settings-menu { border-right: none !important; border-bottom: 1px solid ${colors.border}; }
          .settings-grid, .support-layout { grid-template-columns: 1fr; }
          .support-ticket-desk { grid-template-columns: 1fr !important; overflow-y: auto !important; height: calc(88vh - 73px) !important; }
          .support-ticket-desk > div:first-child { border-right: none !important; border-bottom: 1px solid ${colors.border}; }
          .support-ticket-detail-pane { height: auto !important; overflow: visible !important; }
          .support-chat-panel { right: 12px !important; bottom: 12px !important; width: calc(100vw - 24px) !important; max-height: calc(100vh - 24px) !important; }
          .support-chat-launcher { right: 18px !important; bottom: 18px !important; }
        }
      `}</style>

      <div className="settings-shell">
        <aside className="settings-menu" style={{
          background: colors.panel,
          borderRight: `1px solid ${colors.border}`,
          padding: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <h1 style={{ margin: 0, color: colors.text, fontSize: 21 }}>Settings</h1>
              <p style={{ margin: "4px 0 0", color: colors.muted, fontSize: 13 }}>Account, support and approvals</p>
            </div>
          </div>

          <div style={{ position: "relative", marginTop: 16 }}>
            <Search size={16} color={colors.muted} style={{ position: "absolute", left: 12, top: 13 }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search settings"
              style={{ ...fieldStyle, paddingLeft: 36 }}
            />
          </div>

          <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
            {filteredMenu.map((item) => {
              const Icon = item.icon;
              const selected = active === item.id;
              const count = item.id === "approvals" && pendingCount > 0 ? pendingCount : null;
              return (
                <button key={item.id} type="button" onClick={() => setActive(item.id)} style={{
                  border: `1px solid ${selected ? colors.accent : colors.border}`,
                  background: selected ? colors.accentSoft : colors.panel2,
                  color: colors.text,
                  borderRadius: 8,
                  padding: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  textAlign: "left",
                  cursor: "pointer",
                }}>
                  <span style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: selected ? colors.accent : colors.panel,
                    color: selected ? "#fff" : colors.accent,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <Icon size={18} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 800, fontSize: 14 }}>
                      {item.label} {count ? <Pill tone="pending">{count}</Pill> : null}
                    </span>
                    <span style={{ display: "block", color: colors.muted, fontSize: 12, marginTop: 2 }}>{item.hint}</span>
                  </span>
                  <ChevronRight size={16} color={colors.muted} />
                </button>
              );
            })}
          </div>
        </aside>

        <main style={{ minWidth: 0, padding: 18, background: colors.page }}>
          {notice && (
            <div style={noticeBox(colors, notice.type)} onClick={() => setNotice(null)}>
              {notice.type === "error" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
              {notice.text}
            </div>
          )}

          {loading ? (
            <div style={emptyStateStyle(colors)}>
              <Clock3 size={28} />
              Loading settings...
            </div>
          ) : (
            content()
          )}
        </main>
      </div>
      {renderTicketsModal()}
      {renderSupportWidget()}
    </div>
  );
}

function labelStyle(colors) {
  return {
    display: "grid",
    gap: 6,
    color: colors.muted,
    fontSize: 12,
    fontWeight: 800,
  };
}

function headingStyle(colors) {
  return {
    margin: 0,
    color: colors.text,
    fontSize: 18,
    fontWeight: 850,
  };
}

function subTextStyle(colors) {
  return {
    margin: "5px 0 0",
    color: colors.muted,
    fontSize: 13,
    lineHeight: 1.5,
  };
}

function sectionStyle(colors) {
  return {
    background: colors.panel,
    border: `1px solid ${colors.border}`,
    borderRadius: 10,
    padding: 18,
    boxShadow: "none",
  };
}

function rowCardStyle(colors, roomy = false) {
  return {
    background: colors.panel2,
    border: `1px solid ${colors.border}`,
    borderRadius: 8,
    padding: roomy ? 14 : 12,
    display: "flex",
    alignItems: roomy ? "flex-start" : "center",
    justifyContent: "space-between",
    gap: 12,
  };
}

function emptyStateStyle(colors) {
  return {
    minHeight: 220,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    gap: 10,
    color: colors.muted,
    background: colors.panel,
    border: `1px solid ${colors.border}`,
    borderRadius: 10,
  };
}

function iconButtonStyle(colors) {
  return {
    width: 34,
    height: 34,
    borderRadius: "50%",
    border: `1px solid ${colors.border}`,
    background: colors.panel2,
    color: colors.text,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  };
}

function noticeBox(colors, type) {
  const isError = type === "error";
  const isWarning = type === "warning";
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    borderRadius: 8,
    padding: "10px 12px",
    marginBottom: 14,
    background: isError ? "#fee2e2" : isWarning ? "#fff7ed" : "#dcfce7",
    color: isError ? "#b91c1c" : isWarning ? "#c2410c" : "#166534",
    border: `1px solid ${isError ? "#fecaca" : isWarning ? "#fed7aa" : "#bbf7d0"}`,
    fontSize: 13,
    fontWeight: 700,
    cursor: type === "warning" ? "default" : "pointer",
  };
}
  
