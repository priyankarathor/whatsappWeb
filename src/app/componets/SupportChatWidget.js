"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, MessageSquare, RefreshCcw, Send, X } from "lucide-react";
import API from "../utils/api";

const ISSUE_CATEGORIES = [
  { id: "forgot_password", label: "Forgot password", priority: "high", reply: "I will send your registered email and phone to support so an admin or manager can verify and reset your password." },
  { id: "login", label: "Login issue", priority: "high", reply: "I will create a login ticket. Support will check your account, email, phone, and the login error." },
  { id: "messages", label: "Messages not sending", priority: "medium", reply: "I will create a message-delivery ticket. Support will check the contact number and message flow." },
  { id: "calls", label: "Call not connecting", priority: "high", reply: "I will create a call ticket. Support will check browser/network details and WebRTC connection status." },
  { id: "billing", label: "Billing or plan", priority: "medium", reply: "I will create a billing ticket. Support will review your plan or invoice details." },
  { id: "other", label: "Other issue", priority: "medium", reply: "Tell me what happened and I will create a support ticket for the team." },
];

const roleLabel = (role) => (role === "super_admin" ? "Admin" : role || "Support");

const getTicketUserId = (ticket) => (
  ticket?.user?._id || ticket?.user?.id || ticket?.user || ""
).toString();

const getReplySenderId = (reply) => (
  reply?.sender?._id || reply?.sender?.id || reply?.sender || ""
).toString();

export default function SupportChatWidget({ user, hidden = false }) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState(user || null);
  const [tickets, setTickets] = useState([]);
  const [draft, setDraft] = useState("");
  const [pendingMessages, setPendingMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [lastSeenReplyAt, setLastSeenReplyAt] = useState(0);
  const [error, setError] = useState("");
  const endRef = useRef(null);

  const profileId = (profile?._id || profile?.id || user?._id || user?.id || "").toString();
  const role = profile?.role || user?.role || "";
  const supportStaff = ["super_admin", "manager"].includes(role);
  const isDark = typeof document !== "undefined" && document.body?.dataset?.theme === "dark";

  const colors = {
    panel: "var(--card-bg)",
    panel2: "var(--app-surface-2)",
    text: "var(--app-text)",
    muted: "var(--app-text-muted)",
    border: "var(--app-border)",
    accent: "#00a884",
    accentSoft: isDark ? "rgba(0, 168, 132, 0.22)" : "#ccfbf1",
    input: "var(--input-bg)",
  };

  const myTickets = useMemo(
    () => tickets.filter((ticket) => profileId && getTicketUserId(ticket) === profileId && ticket.status !== "ended"),
    [tickets, profileId]
  );

  const activeTicket = useMemo(
    () => [...myTickets].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null,
    [myTickets]
  );

  const latestStaffReplyTime = useMemo(() => {
    if (supportStaff) return 0;
    return myTickets.reduce((latest, ticket) => {
      const ticketUserId = getTicketUserId(ticket);
      const replyTimes = (ticket.replies || [])
        .filter((reply) => {
          const senderId = getReplySenderId(reply);
          return senderId && senderId !== ticketUserId;
        })
        .map((reply) => new Date(reply.createdAt || 0).getTime());
      return Math.max(latest, 0, ...replyTimes);
    }, 0);
  }, [myTickets, supportStaff]);

  const unreadCount = useMemo(() => {
    if (supportStaff) return 0;
    return myTickets.reduce((count, ticket) => {
      const ticketUserId = getTicketUserId(ticket);
      return count + (ticket.replies || []).filter((reply) => {
        const senderId = getReplySenderId(reply);
        return senderId && senderId !== ticketUserId && new Date(reply.createdAt || 0).getTime() > lastSeenReplyAt;
      }).length;
    }, 0);
  }, [lastSeenReplyAt, myTickets, supportStaff]);

  const refreshTickets = useCallback(async () => {
    try {
      const res = await API.get("/users/support-tickets");
      setTickets(res.data?.data || []);
      setError("");
    } catch (err) {
      setError(err.response?.data?.error || "Could not refresh support chat.");
    }
  }, []);

  useEffect(() => {
    setProfile(user || null);
  }, [user]);

  useEffect(() => {
    setLastSeenReplyAt(Number(localStorage.getItem("supportLastSeenReplyAt") || 0));

    const openSupportChat = () => setOpen(true);
    window.addEventListener("openSupportChat", openSupportChat);
    return () => window.removeEventListener("openSupportChat", openSupportChat);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadProfile = async () => {
      if (profileId) return;
      try {
        const res = await API.get("/users/me");
        if (!cancelled) setProfile(res.data?.data || null);
      } catch {
        if (!cancelled) setProfile(user || null);
      }
    };

    loadProfile();
    return () => { cancelled = true; };
  }, [profileId, user]);

  useEffect(() => {
    refreshTickets();
    const timer = window.setInterval(refreshTickets, 8000);
    return () => window.clearInterval(timer);
  }, [refreshTickets]);

  useEffect(() => {
    if (!open || !latestStaffReplyTime) return;
    setLastSeenReplyAt(latestStaffReplyTime);
    localStorage.setItem("supportLastSeenReplyAt", String(latestStaffReplyTime));
  }, [latestStaffReplyTime, open]);

  useEffect(() => {
    if (!open) return;
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [open, pendingMessages, tickets]);

  const buildIssueMessage = (issue, typedMessage = "") => {
    const accountLines = [
      profile?.name ? `Name: ${profile.name}` : "",
      profile?.email ? `Email: ${profile.email}` : "Email: not set",
      profile?.phone ? `Phone: ${profile.phone}` : "Phone: not set",
    ].filter(Boolean);

    return [
      typedMessage || issue.reply,
      "",
      "Account details:",
      ...accountLines,
    ].join("\n");
  };

  const replyToActiveTicket = async (message) => {
    const text = message.trim();
    if (!text || !activeTicket || busy) return;

    setBusy(true);
    setPendingMessages((prev) => [
      ...prev,
      { by: "user", text },
      { by: "bot", text: "Adding your reply to the current ticket..." },
    ]);

    try {
      const res = await API.post(`/users/support-tickets/${activeTicket._id}/user-replies`, { message: text });
      setTickets((prev) => prev.map((ticket) => ticket._id === activeTicket._id ? res.data.data : ticket));
      setDraft("");
      setPendingMessages([]);
    } catch (err) {
      setPendingMessages((prev) => [
        ...prev,
        { by: "bot", text: err.response?.data?.error || "I could not add your reply. Please try again." },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const createSupportTicket = async ({ issue, typedMessage = "" }) => {
    if (busy) return;

    if (activeTicket) {
      await replyToActiveTicket(typedMessage || issue.label);
      return;
    }

    setOpen(true);
    setBusy(true);
    setPendingMessages((prev) => [
      ...prev,
      { by: "user", text: typedMessage || issue.label },
      { by: "bot", text: "Creating your ticket now..." },
    ]);

    try {
      const res = await API.post("/users/support-tickets", {
        category: issue.id,
        subject: typedMessage ? typedMessage.slice(0, 70) : issue.label,
        message: buildIssueMessage(issue, typedMessage),
        priority: issue.priority || "medium",
      });
      const created = res.data.data;
      setTickets((prev) => [created, ...prev.filter((ticket) => ticket._id !== created._id)]);
      setDraft("");
      setPendingMessages([]);
    } catch (err) {
      const existingTicket = err.response?.data?.activeTicket;
      if (existingTicket) {
        setTickets((prev) => [existingTicket, ...prev.filter((ticket) => ticket._id !== existingTicket._id)]);
        setPendingMessages([]);
      } else {
        setPendingMessages((prev) => [
          ...prev,
          { by: "bot", text: err.response?.data?.error || "I could not create the ticket. Please try again." },
        ]);
      }
    } finally {
      setBusy(false);
    }
  };

  const sendDraft = () => {
    const text = draft.trim();
    if (!text) return;
    if (activeTicket) {
      replyToActiveTicket(text);
      return;
    }
    const issue = ISSUE_CATEGORIES.find((item) => item.id === "other") || ISSUE_CATEGORIES[0];
    createSupportTicket({ issue, typedMessage: text });
  };

  const supportChat = useMemo(() => {
    const introName = profile?.name?.trim() || profile?.email || "there";
    const messages = [
      {
        by: "bot",
        text: `Hi ${introName}, pick an issue below or type your question.`,
      },
    ];

    [...myTickets]
      .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
      .forEach((ticket) => {
        messages.push({
          by: "user",
          text: ticket.subject,
          meta: ticket.createdAt ? new Date(ticket.createdAt).toLocaleString() : "",
        });
        if (ticket.message && ticket.message !== ticket.subject) {
          messages.push({
            by: "user",
            text: ticket.message,
            meta: ticket.createdAt ? new Date(ticket.createdAt).toLocaleString() : "",
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
            const senderId = getReplySenderId(reply);
            messages.push({
              by: senderId && senderId === profileId ? "user" : "bot",
              text: reply.message,
              meta: `${reply.sender?.name || roleLabel(reply.senderRole)} - ${reply.createdAt ? new Date(reply.createdAt).toLocaleString() : ""}`,
            });
          });
      });

    return [...messages, ...pendingMessages];
  }, [myTickets, pendingMessages, profile?.email, profile?.name, profileId]);

  if (hidden || !profile) return null;

  return (
    <>
      <style>{`
        @keyframes supportLauncherPulse {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-2px) scale(1.04); }
        }
        @keyframes supportPanelIn {
          from { opacity: 0; transform: translateY(18px) scale(0.92); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes supportBubbleIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .support-chat-panel-global {
          animation: supportPanelIn 0.24s cubic-bezier(0.22, 1, 0.36, 1) both;
          transform-origin: bottom right;
        }
        .support-chat-panel-global input::placeholder { color: var(--app-text-muted); }
        .support-chat-launcher-global:hover { transform: translateY(-2px) scale(1.04); }
        @media (max-width: 820px) {
          .support-chat-launcher-global { right: 18px !important; bottom: 84px !important; }
          .support-chat-panel-global {
            right: 10px !important;
            bottom: 82px !important;
            width: calc(100vw - 20px) !important;
            max-height: calc(100vh - 112px) !important;
          }
        }
      `}</style>

      {!open && (
        <button
          type="button"
          className="support-chat-launcher-global"
          onClick={() => setOpen(true)}
          title="Open support chat"
          style={{
            position: "fixed",
            right: 22,
            bottom: 22,
            width: 44,
            height: 44,
            borderRadius: "50%",
            border: "none",
            background: "#00a884",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 12px 28px rgba(0, 168, 132, 0.32)",
            cursor: "pointer",
            zIndex: 1040,
            transition: "transform 0.18s ease, box-shadow 0.18s ease",
            animation: unreadCount > 0 ? "supportLauncherPulse 1.8s ease-in-out infinite" : "none",
          }}
        >
          <MessageSquare size={19} />
          {unreadCount > 0 && (
            <span style={{
              position: "absolute",
              top: -4,
              right: -4,
              minWidth: 18,
              height: 18,
              borderRadius: 999,
              background: "#ef4444",
              color: "#fff",
              border: `2px solid ${colors.panel}`,
              fontSize: 10,
              fontWeight: 900,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 4px",
            }}>
              {unreadCount}
            </span>
          )}
        </button>
      )}

      {open && (
        <div
          className="support-chat-panel-global"
          style={{
            position: "fixed",
            right: 22,
            bottom: 22,
            width: "min(380px, calc(100vw - 24px))",
            maxHeight: "min(560px, calc(100vh - 72px))",
            borderRadius: 12,
            overflow: "hidden",
            background: colors.panel,
            border: `1px solid ${colors.border}`,
            boxShadow: isDark ? "0 24px 64px rgba(0,0,0,0.54)" : "0 24px 64px rgba(15,23,42,0.2)",
            display: "flex",
            flexDirection: "column",
            zIndex: 1040,
          }}
        >
          <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "#00a884",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}>
              <Bot size={17} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: colors.text, fontWeight: 850, fontSize: 14 }}>Customer Support</div>
              <div style={{ color: colors.muted, fontSize: 11 }}>{activeTicket ? "Replying in your active ticket" : "Tickets and replies"}</div>
            </div>
            <button type="button" onClick={refreshTickets} title="Refresh" style={iconButtonStyle(colors)}>
              <RefreshCcw size={16} />
            </button>
            <button type="button" onClick={() => setOpen(false)} title="Minimize" style={iconButtonStyle(colors)}>
              <X size={16} />
            </button>
          </div>

          {error && (
            <div style={{ margin: "0 14px 10px", color: "#b91c1c", background: "#fee2e2", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}>
              {error}
            </div>
          )}

          <div style={{
            flex: 1,
            minHeight: 220,
            overflowY: "auto",
            padding: "10px 14px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 9,
            background: isDark ? "#0b1220" : "#f8fafc",
            borderTop: `1px solid ${colors.border}`,
            borderBottom: `1px solid ${colors.border}`,
          }}>
            {supportChat.map((msg, index) => (
              <div key={`${msg.by}-${index}`} style={{
                display: "flex",
                justifyContent: msg.by === "user" ? "flex-end" : "flex-start",
                animation: "supportBubbleIn 0.18s ease both",
              }}>
                <div style={{
                  maxWidth: "86%",
                  borderRadius: msg.by === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                  background: msg.by === "user" ? colors.accentSoft : colors.panel,
                  color: msg.by === "user" ? (isDark ? "#d1fae5" : colors.accent) : colors.text,
                  border: `1px solid ${msg.by === "user" ? colors.accent : colors.border}`,
                  padding: "8px 10px",
                  fontSize: 12,
                  lineHeight: 1.45,
                  whiteSpace: "pre-wrap",
                }}>
                  <div>{msg.text}</div>
                  {msg.meta && <div style={{ color: colors.muted, fontSize: 10, marginTop: 4 }}>{msg.meta}</div>}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <div style={{ padding: 12, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {ISSUE_CATEGORIES.map((issue) => (
                <button
                  key={issue.id}
                  type="button"
                  disabled={busy}
                  onClick={() => createSupportTicket({ issue })}
                  style={{
                    border: `1px solid ${colors.border}`,
                    background: colors.panel2,
                    color: colors.text,
                    borderRadius: 999,
                    padding: "6px 9px",
                    fontSize: 11,
                    fontWeight: 750,
                    cursor: busy ? "not-allowed" : "pointer",
                    opacity: busy ? 0.7 : 1,
                  }}
                >
                  {activeTicket ? `Reply: ${issue.label}` : issue.label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendDraft();
                  }
                }}
                placeholder={activeTicket ? "Reply to your ticket..." : "Type your issue..."}
                disabled={busy}
                style={{
                  width: "100%",
                  height: 38,
                  borderRadius: 999,
                  border: `1px solid ${colors.border}`,
                  background: colors.input,
                  color: colors.text,
                  outline: "none",
                  padding: "0 13px",
                  fontSize: 13,
                }}
              />
              <button
                type="button"
                disabled={busy || !draft.trim()}
                onClick={sendDraft}
                title="Send"
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: "50%",
                  border: "none",
                  background: busy || !draft.trim() ? colors.panel2 : colors.accent,
                  color: busy || !draft.trim() ? colors.muted : "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: busy || !draft.trim() ? "not-allowed" : "pointer",
                  flexShrink: 0,
                }}
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function iconButtonStyle(colors) {
  return {
    width: 30,
    height: 30,
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    background: colors.panel2,
    color: colors.text,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
  };
}
