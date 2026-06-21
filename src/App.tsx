import { useEffect, useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { parseEther, formatEther } from "viem";
import { motion, useReducedMotion } from "framer-motion";
import { Scales, ShieldCheck, FileText, Gavel, Handshake } from "@phosphor-icons/react";
import {
  createDispute, submitEvidence, adjudicateSplit, release,
  getCase, getCounts, getPoolBalance, listAll, CaseView, CaseRow,
} from "./contractService";

type Hex = `0x${string}`;

const STATUS_LABEL = ["awaiting seller", "ready for ruling", "ruled", "settled"];

function shortAddr(a: string): string {
  return a && a.length > 12 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a || "-";
}

function gen(wei: string): string {
  if (!wei || wei === "0") return "0";
  try {
    const v = formatEther(BigInt(wei));
    return v.length > 10 ? Number(v).toLocaleString("en-US", { maximumFractionDigits: 4 }) : v;
  } catch {
    return "0";
  }
}

function verdictText(verdict: string): string {
  return verdict ? verdict.replace("_", " ").toLowerCase() : "awaiting ruling";
}

function SplitBar({ share, verdict, big }: { share: number; verdict: string; big?: boolean }) {
  const reduce = useReducedMotion();
  const ruled = !!verdict;
  const buyer = ruled ? Math.max(0, Math.min(100, share)) : 50;
  const seller = 100 - buyer;
  return (
    <div className={`splitbar ${big ? "big" : ""} ${ruled ? "" : "pending"}`} role="img" aria-label={ruled ? `Buyer ${buyer}%, seller ${seller}%` : "Awaiting ruling"}>
      <div className="sb-track">
        <motion.div className="sb-buyer" initial={reduce ? false : { width: "50%" }} animate={{ width: `${buyer}%` }} transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }} />
        <motion.div className="sb-seller" initial={reduce ? false : { width: "50%" }} animate={{ width: `${seller}%` }} transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }} />
      </div>
      {big && (
        <div className="sb-marks">
          <span className="sb-m buyer">buyer {buyer}%</span>
          <span className={`sb-v v-${verdict || "none"}`}>{verdictText(verdict)}</span>
          <span className="sb-m seller">seller {seller}%</span>
        </div>
      )}
    </div>
  );
}

function TextBlock({ title, text, tone }: { title: string; text: string; tone?: "buyer" | "seller" | "ruling" }) {
  return (
    <div className={`evidence ${tone || ""}`}>
      <span>{title}</span>
      <p>{text || "No evidence on-chain yet."}</p>
    </div>
  );
}

function StepRail({ status, selected }: { status: number; selected: boolean }) {
  const steps = [
    { label: "escrow opened", icon: FileText, at: 0 },
    { label: "seller answered", icon: Handshake, at: 1 },
    { label: "validators ruled", icon: Gavel, at: 2 },
    { label: "funds released", icon: ShieldCheck, at: 3 },
  ];
  return (
    <div className="step-rail" aria-label="Case progress">
      {steps.map((s) => {
        const done = selected && status >= s.at;
        const current = selected && status === s.at;
        return (
          <div key={s.label} className={`step ${done ? "done" : ""} ${current ? "current" : ""}`}>
            <span className="step-dot"><s.icon weight={done ? "duotone" : "regular"} /></span>
            <span>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function App() {
  const { address, isConnected } = useAccount();
  const acct = address as Hex | undefined;
  const reduce = useReducedMotion();

  const [seller, setSeller] = useState("");
  const [listing, setListing] = useState("");
  const [buyerEvidence, setBuyerEvidence] = useState("");
  const [escrow, setEscrow] = useState("");
  const [sellerEvidence, setSellerEvidence] = useState("");
  const [rows, setRows] = useState<CaseRow[]>([]);
  const [counts, setCounts] = useState({ next: 0, ruled: 0, settled: 0 });
  const [pool, setPool] = useState("0");
  const [selId, setSelId] = useState<number | null>(null);
  const [sel, setSel] = useState<CaseView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [netErr, setNetErr] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refreshAll() {
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const [c, p, l] = await Promise.all([getCounts(), getPoolBalance(), listAll(50)]);
      setCounts(c);
      setPool(p);
      setRows(l);
      if (selId != null) {
        try { setSel(await getCase(selId)); } catch { /* keep current selection */ }
      }
      setNetErr(false);
    } catch {
      setNetErr(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshAll();
    const t = setInterval(refreshAll, 12000);
    const onVis = () => { if (!document.hidden) refreshAll(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  async function pick(id: number) {
    setSelId(id);
    setSellerEvidence("");
    try { setSel(await getCase(id)); } catch { setSel(null); }
  }

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setNote("");
    try {
      return await fn();
    } catch (e) {
      setNote(String((e as Error).message || e).slice(0, 220));
      return undefined;
    } finally {
      setBusy(null);
      refreshAll();
    }
  }

  async function onCreate() {
    if (!acct) return;
    if (!/^0x[a-fA-F0-9]{40}$/.test(seller.trim())) return setNote("Seller must be a 0x address.");
    if (listing.trim().length < 25) return setNote("Listing terms: at least 25 characters.");
    if (buyerEvidence.trim().length < 25) return setNote("Buyer evidence: at least 25 characters.");
    if (!escrow.trim() || !(Number(escrow) > 0)) return setNote("Escrow amount in GEN is required.");
    const id = await run("Opening dispute and escrowing funds", () => createDispute(acct, { seller, listing, buyerEvidence, escrowWei: parseEther(escrow) }));
    if (id != null) {
      setSelId(id);
      setSeller("");
      setListing("");
      setBuyerEvidence("");
      setEscrow("");
      setNote(`Dispute #${id} opened. The seller can now answer.`);
    }
  }

  async function onSubmitEvidence() {
    if (!acct || selId == null) return;
    if (sellerEvidence.trim().length < 25) return setNote("Seller evidence: at least 25 characters.");
    await run("Submitting seller evidence", () => submitEvidence(acct, selId, sellerEvidence));
    setSellerEvidence("");
  }

  async function onAdjudicate() {
    if (!acct || selId == null) return;
    await run("Validators weighing both sides", () => adjudicateSplit(acct, selId));
  }

  async function onRelease() {
    if (!acct || selId == null) return;
    await run("Releasing the escrow split", () => release(acct, selId));
  }

  const activeCase = sel !== null && selId !== null ? { id: selId, data: sel } : null;
  const selected = activeCase !== null;
  const settleRate = useMemo(() => counts.ruled > 0 ? Math.round((counts.settled / counts.ruled) * 100) : 0, [counts]);
  const buyerShare = activeCase ? activeCase.data.buyerShare : 50;
  const verdict = activeCase ? activeCase.data.verdict : "";
  const status = activeCase ? activeCase.data.status : 0;

  return (
    <div className="evenhand">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Scales weight="duotone" /></span>
          <div>
            <span className="wm">Even Hand</span>
            <span className="brand-tag">escrow arbitration desk</span>
          </div>
        </div>
        <div className="top-actions">
          <span className="live"><span className={`live-dot ${netErr ? "err" : ""}`} />{netErr ? "reconnecting" : "studionet live"}</span>
          <ConnectButton showBalance={false} chainStatus="none" accountStatus="address" />
        </div>
      </header>

      <main className="arb-shell">
        <section className="room-head">
          <div>
            <p className="eyebrow">arbitration room</p>
            <h1>{activeCase ? `Dispute ${activeCase.id}` : "Open a balanced escrow case"}</h1>
          </div>
          <div className="room-stats" aria-label="Contract metrics">
            <div><b>{counts.next}</b><span>opened</span></div>
            <div><b>{counts.ruled}</b><span>ruled</span></div>
            <div><b>{settleRate}%</b><span>settled</span></div>
            <div><b>{gen(pool)}</b><span>GEN pool</span></div>
          </div>
        </section>

        <section className="arbitration-room">
          <motion.article className="party-pane buyer-pane" initial={reduce ? false : { opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.42 }}>
            <div className="pane-head">
              <span className="party-kicker">buyer side</span>
              <strong>{activeCase ? shortAddr(activeCase.data.buyer) : "new claimant"}</strong>
            </div>
            {activeCase ? (
              <>
                <TextBlock title="Listing terms" text={activeCase.data.listing} tone="buyer" />
                <TextBlock title="Buyer evidence" text={activeCase.data.buyerEvidence} tone="buyer" />
              </>
            ) : (
              <>
                <label>Listing terms</label>
                <textarea value={listing} onChange={(e) => setListing(e.target.value)} placeholder="Item, condition, guarantees, and what was promised." />
                <label>Buyer evidence</label>
                <textarea value={buyerEvidence} onChange={(e) => setBuyerEvidence(e.target.value)} placeholder="What happened, what failed, and why funds should return." />
              </>
            )}
          </motion.article>

          <motion.article className="verdict-core" initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.46, delay: 0.05 }}>
            <div className="scale-stage" aria-hidden="true">
              <div className="scale-beam" />
              <div className="scale-post" />
              <div className="pan pan-left" />
              <div className="pan pan-right" />
              <Scales weight="duotone" />
            </div>

            <div className="verdict-copy">
              <span className={`status-pill v-${verdict || "none"}`}>{activeCase ? STATUS_LABEL[status] : "draft case"}</span>
              <h2>{activeCase ? verdictText(verdict) : "Evidence first, ruling after both sides answer"}</h2>
            </div>

            <SplitBar share={buyerShare} verdict={verdict} big />

            <div className="core-metrics">
              <div><span>escrow</span><b>{activeCase ? gen(activeCase.data.escrow) : escrow || "0"} GEN</b></div>
              <div><span>buyer</span><b>{activeCase && verdict ? `${buyerShare}%` : "pending"}</b></div>
              <div><span>seller</span><b>{activeCase && verdict ? `${100 - buyerShare}%` : "pending"}</b></div>
            </div>

            {!selected && (
              <div className="escrow-input">
                <label>Escrow amount (GEN)</label>
                <input value={escrow} onChange={(e) => setEscrow(e.target.value)} placeholder="e.g. 1.5" inputMode="decimal" />
              </div>
            )}
          </motion.article>

          <motion.article className="party-pane seller-pane" initial={reduce ? false : { opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.42 }}>
            <div className="pane-head">
              <span className="party-kicker">seller side</span>
              <strong>{activeCase ? shortAddr(activeCase.data.seller) : "counterparty"}</strong>
            </div>
            {activeCase ? (
              <>
                <TextBlock title="Seller evidence" text={activeCase.data.sellerEvidence} tone="seller" />
                {activeCase.data.rationale && <TextBlock title="Validator rationale" text={activeCase.data.rationale} tone="ruling" />}
                {activeCase.data.status === 0 && (
                  <>
                    <label>Seller evidence</label>
                    <textarea value={sellerEvidence} onChange={(e) => setSellerEvidence(e.target.value)} placeholder="Seller rebuttal and supporting facts." />
                  </>
                )}
              </>
            ) : (
              <>
                <label>Seller address</label>
                <input value={seller} onChange={(e) => setSeller(e.target.value)} placeholder="0x..." />
                <div className="seller-hold">
                  <Handshake weight="duotone" />
                  <span>Seller evidence opens after the escrow case is created.</span>
                </div>
              </>
            )}
          </motion.article>
        </section>

        <section className="timeline-band">
          <StepRail status={status} selected={!!activeCase} />
        </section>

        <section className="command-bar" aria-label="Contract actions">
          <div>
            <span className="command-label">{activeCase ? "selected case" : "draft case"}</span>
            <strong>{activeCase ? `Dispute ${activeCase.id} - ${STATUS_LABEL[status]}` : "Ready when buyer, seller, evidence, and escrow are filled"}</strong>
          </div>
          <div className="command-actions">
            {activeCase && <button type="button" className="btn-ghost" onClick={() => { setSelId(null); setSel(null); }}>New dispute</button>}
            {!activeCase && <button className="btn-primary" disabled={!isConnected || !!busy} onClick={onCreate}>{isConnected ? "Escrow funds and open" : "Connect wallet to open"}</button>}
            {activeCase && activeCase.data.status === 0 && <button className="btn-primary" disabled={!isConnected || !!busy} onClick={onSubmitEvidence}>Submit seller evidence</button>}
            {activeCase && activeCase.data.status === 1 && <button className="btn-primary" disabled={!isConnected || !!busy} onClick={onAdjudicate}>Adjudicate split</button>}
            {activeCase && activeCase.data.status === 2 && <button className="btn-primary" disabled={!isConnected || !!busy} onClick={onRelease}>Release escrow</button>}
            {activeCase && activeCase.data.status === 3 && <span className="settled">Settled on-chain</span>}
          </div>
        </section>
      </main>

      <section className="ledger-section">
        <div className="desk-h">
          <div>
            <p className="eyebrow">case ledger</p>
            <h2>Disputes on-chain</h2>
          </div>
        </div>

        {loading ? (
          <div className="skel-wrap">{[0, 1, 2].map((i) => <div key={i} className="skel" />)}</div>
        ) : rows.length === 0 ? (
          <div className="empty">
            <Scales weight="duotone" />
            <h3>No disputes yet</h3>
            <p>The first escrow case will appear here after it is written to the contract.</p>
          </div>
        ) : (
          <div className="cases">
            {rows.map((r, i) => (
              <motion.button
                key={r.id}
                className={`case ${selId === r.id ? "sel" : ""}`}
                onClick={() => pick(r.id)}
                initial={reduce ? false : { opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.35, delay: Math.min(i, 6) * 0.04 }}
                aria-label={`Dispute ${r.id}, ${verdictText(r.verdict)}`}
              >
                <span className="case-id">#{r.id}</span>
                <span className={`tag v-${r.verdict || "none"}`}>{verdictText(r.verdict)}</span>
                <strong>{gen(r.escrow)} GEN</strong>
                <p>{r.listing}</p>
                <SplitBar share={r.buyerShare} verdict={r.verdict} />
                <small>{STATUS_LABEL[r.status]}</small>
              </motion.button>
            ))}
          </div>
        )}
      </section>

      <footer className="foot">
        <span><Scales weight="duotone" /> Even Hand</span>
        <span>GenLayer studionet arbitration contract.</span>
      </footer>

      {(busy || note) && <div className="toast">{busy ? `${busy}...` : note}</div>}
    </div>
  );
}
