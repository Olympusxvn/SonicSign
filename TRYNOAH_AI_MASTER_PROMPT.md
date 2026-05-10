# SonicSign — Noah AI Build Instruction

## Project Identity

**Product name**: SonicSign  
**One-liner**: "Your voice confirms every transaction. No click. No doubt."  
**Type**: Solana dApp — voice-guided transaction confirmation middleware  
**Network**: Solana Devnet  
**Hackathon**: Dev3pack Global Hackathon 2026 (May 8–10)  
**Sponsors used**: ElevenLabs (core), Phantom Wallet, Solana

---

## What You Are Building

A Solana dApp where the user connects their Phantom wallet, and before any SOL transfer is submitted on-chain, an **ElevenLabs AI voice agent reads the full transaction details aloud** and asks the user to confirm verbally. The user speaks "confirm" or "cancel". Only upon voice confirmation does the app proceed to sign and submit the transaction via Phantom.

This solves the "fat-finger" and "social engineering" problem in DeFi — users hear what they are about to sign in plain language before it executes.

---

## Core User Flow (The Golden Loop)

```
1. User opens app → connects Phantom wallet
2. User sees their SOL balance and a "Send SOL" panel
3. User fills in: recipient address + amount
4. User clicks "Voice Confirm"
5. ElevenLabs TTS speaks aloud:
   "You are about to send [X] SOL to address [first 4]...[last 4].
    This action is irreversible. Say confirm to proceed, or cancel to abort."
6. ElevenLabs Speech Recognition listens for user response
7. If "confirm" → Phantom wallet signs → transaction submits to Devnet → success toast
8. If "cancel" or silence → transaction aborted → cancel toast
9. Transaction history shows in a log below the panel
```

---

## Technical Stack

| Layer | Technology |
|---|---|
| Platform | Noah AI (vibe coding) |
| Frontend framework | Next.js 14 (App Router) |
| Styling | Tailwind CSS |
| Wallet | `@solana/wallet-adapter-react` + `@solana/wallet-adapter-phantom` |
| Blockchain | `@solana/web3.js` — Devnet |
| Voice (TTS) | ElevenLabs Text-to-Speech REST API |
| Voice (STT) | Web Speech API (`SpeechRecognition`) — browser native, no extra cost |
| State | React hooks only — no Redux |

---

## ElevenLabs Integration (Core Feature)

### TTS — Read Transaction Details Aloud

Use the ElevenLabs TTS REST API to synthesize the confirmation prompt.

```typescript
// lib/elevenlabs.ts

const VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel — clear, authoritative
const API_KEY = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY;

export async function speakTransactionPrompt(
  amount: number,
  recipientAddress: string
): Promise<void> {
  const shortAddress = `${recipientAddress.slice(0, 4)}...${recipientAddress.slice(-4)}`;
  const text = `You are about to send ${amount} SOL to address ${shortAddress}. 
                This action is irreversible. 
                Say confirm to proceed, or cancel to abort.`;

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_monolingual_v1",
        voice_settings: { stability: 0.75, similarity_boost: 0.85 },
      }),
    }
  );

  const audioBlob = await response.blob();
  const audioUrl = URL.createObjectURL(audioBlob);
  const audio = new Audio(audioUrl);
  await audio.play();

  // Wait for audio to finish before starting STT
  await new Promise((resolve) => {
    audio.onended = resolve;
  });
}
```

### STT — Listen for Confirm / Cancel

Use the browser-native Web Speech API immediately after TTS finishes.

```typescript
// lib/speechRecognition.ts

export function listenForConfirmation(): Promise<"confirm" | "cancel" | "timeout"> {
  return new Promise((resolve) => {
    const SpeechRecognition =
      window.SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      resolve("timeout");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.maxAlternatives = 3;
    recognition.continuous = false;

    const timer = setTimeout(() => {
      recognition.stop();
      resolve("timeout");
    }, 8000); // 8 second window

    recognition.onresult = (event) => {
      clearTimeout(timer);
      const transcript = event.results[0][0].transcript.toLowerCase().trim();
      if (transcript.includes("confirm")) resolve("confirm");
      else resolve("cancel");
    };

    recognition.onerror = () => {
      clearTimeout(timer);
      resolve("cancel");
    };

    recognition.start();
  });
}
```

---

## Solana Transaction Logic

```typescript
// lib/solana.ts
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

const connection = new Connection(
  "https://api.devnet.solana.com",
  "confirmed"
);

export async function sendSOL(
  senderPublicKey: PublicKey,
  recipientAddress: string,
  amountSOL: number,
  signTransaction: (tx: Transaction) => Promise<Transaction>
): Promise<string> {
  const recipient = new PublicKey(recipientAddress);
  const lamports = amountSOL * LAMPORTS_PER_SOL;

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: senderPublicKey,
      toPubkey: recipient,
      lamports,
    })
  );

  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = senderPublicKey;

  const signed = await signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction(signature, "confirmed");

  return signature;
}
```

---

## Complete Voice Confirm Flow (Component)

```typescript
// components/VoiceConfirmFlow.tsx
"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { speakTransactionPrompt } from "@/lib/elevenlabs";
import { listenForConfirmation } from "@/lib/speechRecognition";
import { sendSOL } from "@/lib/solana";

type Step = "idle" | "speaking" | "listening" | "processing" | "success" | "cancelled" | "error";

export function VoiceConfirmFlow({ amount, recipient }: { amount: number; recipient: string }) {
  const { publicKey, signTransaction } = useWallet();
  const [step, setStep] = useState<Step>("idle");
  const [txSig, setTxSig] = useState<string | null>(null);

  async function handleVoiceConfirm() {
    if (!publicKey || !signTransaction) return;

    try {
      // Step 1: ElevenLabs speaks transaction details
      setStep("speaking");
      await speakTransactionPrompt(amount, recipient);

      // Step 2: Listen for user's voice response
      setStep("listening");
      const result = await listenForConfirmation();

      if (result !== "confirm") {
        setStep("cancelled");
        return;
      }

      // Step 3: Submit transaction
      setStep("processing");
      const sig = await sendSOL(publicKey, recipient, amount, signTransaction);
      setTxSig(sig);
      setStep("success");
    } catch (err) {
      setStep("error");
    }
  }

  return (
    <div className="voice-confirm-panel">
      {/* UI rendering based on step — see UI spec below */}
      <button onClick={handleVoiceConfirm} disabled={step !== "idle"}>
        🎙 Voice Confirm
      </button>

      {step === "speaking" && <p>🔊 Listening to transaction details...</p>}
      {step === "listening" && <p>🎤 Say "confirm" or "cancel"</p>}
      {step === "processing" && <p>⏳ Submitting to Solana...</p>}
      {step === "success" && (
        <p>✅ Sent! <a href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`} target="_blank">View on Explorer</a></p>
      )}
      {step === "cancelled" && <p>❌ Transaction cancelled by voice.</p>}
      {step === "error" && <p>⚠️ Something went wrong. Try again.</p>}
    </div>
  );
}
```

---

## UI Specification

### Visual Identity — Cyberpunk Terminal

| Token | Value |
|---|---|
| Background | `#080b12` |
| Surface | `#0f1623` |
| Primary accent | `#00f0ff` (neon cyan) |
| Secondary accent | `#ff00aa` (magenta) |
| Success | `#00ff88` (green) |
| Danger | `#ff3355` (red) |
| Font — data/addresses | `JetBrains Mono` |
| Font — UI labels | `Space Grotesk` |
| Border style | `1px solid rgba(0,240,255,0.3)` with glow on active |

### Page Layout: `/` (Landing)

```
┌─────────────────────────────────────────────┐
│  🔊 SonicSign          [Connect Wallet]      │
├─────────────────────────────────────────────┤
│                                             │
│   "Your voice confirms every transaction."  │
│                                             │
│   [Launch App →]                            │
│                                             │
│   Built with: Solana · ElevenLabs · Phantom │
└─────────────────────────────────────────────┘
```

### Page Layout: `/app` (Dashboard)

```
┌──────────────────────────────────────────────────┐
│  🔊 SonicSign             👛 ABC...XYZ  [Devnet]  │
├──────────────────────────────────────────────────┤
│  Balance: 4.20 SOL                               │
├──────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────┐  │
│  │  Send SOL                                  │  │
│  │  Recipient: [_____________________]        │  │
│  │  Amount:    [___] SOL                      │  │
│  │                                            │  │
│  │  ████████████  🎙 VOICE CONFIRM  ████████  │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  [SPEAKING]  🔊 ───── waveform ─────             │
│  [LISTENING] 🎤 ───── pulsing mic ─────          │
│  [SUCCESS]   ✅ TX: abc...xyz | Explorer ↗       │
│                                                  │
│  Recent Transactions                             │
│  ├ 2.0 SOL → DEF...789  ✅  12s ago             │
│  └ 0.5 SOL → GHI...012  ❌  cancelled  3m ago   │
└──────────────────────────────────────────────────┘
```

### Voice State Animations

- **SPEAKING**: Animated sound bars (cyan) pulsing to fake audio rhythm, label "AI Reading Transaction..."
- **LISTENING**: Pulsing microphone icon (magenta), concentric ring animation, label "Say CONFIRM or CANCEL"
- **PROCESSING**: Spinning Solana logo, label "Submitting to Devnet..."
- **SUCCESS**: Green glow flash, checkmark, transaction hash with Explorer link
- **CANCELLED**: Red border flash, "Transaction aborted by voice"

---

## Environment Variables Required

```env
NEXT_PUBLIC_ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
```

No other secrets needed. Wallet signing happens client-side via Phantom.

---

## Pages & Routes

| Route | Purpose |
|---|---|
| `/` | Landing — hero, one-liner, "Launch App" button, sponsor logos |
| `/app` | Main dashboard — wallet connect, send panel, voice flow, tx log |

---

## What NOT to Build

- No Anchor/Rust smart contract (use native SOL transfer — simpler, faster, demo-ready)
- No backend server or database
- No Python services
- No custom wallet — Phantom only via wallet-adapter
- No real mainnet transactions — Devnet only

---

## Airdrop for Testing

The app should include a "Get Devnet SOL" button that calls:

```typescript
await connection.requestAirdrop(publicKey, 2 * LAMPORTS_PER_SOL);
```

---

## Demo Script (for judges — 60 seconds)

1. Open app, connect Phantom (Devnet)
2. Click "Get Devnet SOL" → show balance
3. Paste a recipient address, enter 0.1 SOL
4. Click "Voice Confirm"
5. ElevenLabs speaks: *"You are about to send 0.1 SOL to ABC...XYZ. Say confirm to proceed..."*
6. Say "confirm" into mic
7. Transaction confirms on-chain
8. Show Solana Explorer link
9. Repeat — this time say "cancel" → transaction aborted

**Key pitch line**: *"You can steal a private key. You can clone a passphrase. But you can't silently hijack a voice confirmation in real-time."*

---

## Post-Hackathon Expansion: SonicSign Voice Agent

### Concept

Sau hackathon, SonicSign có thể mở rộng thành một **voice-enabled DeFi assistant** — không chỉ xác nhận giao dịch mà còn chủ động nói chuyện với user về portfolio, market, và on-chain activity. ElevenLabs làm giọng nói, một LLM (GPT-4o hoặc Claude) làm brain, Solana làm data source.

**Tagline mở rộng**: *"SonicSign Agent — your DeFi portfolio speaks to you."*

---

### Expansion Noah AI Prompt

```
Extend SonicSign with a Voice DeFi Agent feature.

Add a new route /agent to the existing SonicSign Next.js app.

The agent is a persistent voice AI assistant that:
1. Reads the user's connected Phantom wallet address
2. Fetches their SOL balance and top SPL token holdings via @solana/web3.js and the Helius RPC API
3. Uses OpenAI GPT-4o (or Claude claude-sonnet-4-20250514) to generate a natural language market summary and portfolio update
4. Speaks the summary aloud using ElevenLabs TTS — same voice as the main app (Rachel, voice ID 21m00Tcm4TlvDq8ikWAM)
5. After speaking, activates the browser SpeechRecognition API and listens for follow-up questions
6. The user can ask things like: "What is my biggest holding?", "How much SOL do I have?", "Should I be worried about my portfolio?"
7. The agent responds with another ElevenLabs-spoken answer
8. This creates a full voice conversation loop: speak → listen → speak → listen

UI for /agent page:
- Same cyberpunk dark theme as main app (#080b12 background, #00f0ff cyan accents)
- Large animated orb in the center — pulses cyan when speaking, pulses magenta when listening, static when idle
- Transcript panel on the side showing the conversation history as text
- "Start Briefing" button to trigger the first portfolio summary
- "Ask a Question" button to re-activate the microphone manually

New environment variables needed:
NEXT_PUBLIC_HELIUS_API_KEY — for enriched Solana RPC data
OPENAI_API_KEY — for GPT-4o (server-side only, use Next.js API route)

The LLM prompt for generating the briefing:
"You are a concise DeFi voice assistant. The user's wallet holds: {portfolio_data}. 
Current SOL price: {sol_price}. 
Give a 3-sentence spoken portfolio update. Be direct, no markdown, no bullet points. 
End with one actionable observation."

The voice loop flow:
idle → fetch portfolio data → LLM generates briefing → ElevenLabs speaks → 
SpeechRecognition listens → user asks question → LLM answers → ElevenLabs speaks → 
SpeechRecognition listens → loop

Keep the /app route (voice transaction confirmation) intact. The /agent route is additive only.
```

---

### Expansion Stack (additional dependencies)

| Addition | Purpose |
|---|---|
| Helius RPC API | Enriched wallet data — token balances, NFTs, transaction history |
| OpenAI GPT-4o | Natural language briefing + Q&A brain |
| Next.js API Route `/api/brief` | Server-side LLM call (hides OpenAI key) |
| ElevenLabs Conversational AI SDK | Optional upgrade — replaces manual TTS+STT loop with streaming conversation |

### Why This Works as a Product

- **MVP** (hackathon): Voice confirms transactions → security tool
- **V2** (post-hackathon): Voice briefs portfolio + answers questions → DeFi assistant
- **V3**: Agent monitors wallets 24/7, sends voice alerts for large movements, price triggers, liquidation risks

Same ElevenLabs + Solana core. Incrementally more useful at each step.

---

## Noah AI Prompt (paste this directly)

```
Build a Solana dApp called SonicSign. 

The app connects to Phantom wallet on Devnet. Users can send SOL transfers, but before any transaction is submitted, an ElevenLabs AI voice reads the transaction details aloud (amount + recipient address), then listens for the user to say "confirm" or "cancel" using the browser's Web Speech API. Only if the user says "confirm" does the app sign and submit the transaction via Phantom.

Stack: Next.js 14 App Router, Tailwind CSS, @solana/wallet-adapter-react with Phantom, @solana/web3.js for Devnet transactions, ElevenLabs TTS REST API for the voice prompt.

UI: Dark cyberpunk theme. Background #080b12, neon cyan #00f0ff accents, magenta #ff00aa secondary. JetBrains Mono for addresses. Animated waveform when ElevenLabs is speaking. Pulsing microphone ring when listening. Two routes: / landing page and /app dashboard.

Include a "Get Devnet SOL" airdrop button for testing. Show a transaction history log. No backend server, no smart contract — just native SOL transfer via SystemProgram.transfer.

Environment variable: NEXT_PUBLIC_ELEVENLABS_API_KEY for the ElevenLabs API key.
```
