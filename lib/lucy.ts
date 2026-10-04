import { decode, encode } from "@msgpack/msgpack";

const LUCY_WS = "wss://fal.run/decart/lucy2-vton/realtime";
const FALLBACK_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
const READY_TIMEOUT_MS = 45000;

export const DEFAULT_PROMPT =
  "Change the person's hair into the wig from the reference image: the same hair colour, length and style, including bangs, braids and any ears or headpieces, worn on their head. Then substitute their outfit with the cosplay costume from the reference image, matching its colours, materials, accessories and fit. Keep their face and identity.";

export type LucyStatus = "connecting" | "signalling" | "live" | "closed" | "error";

export type LucyState = { prompt: string; reference_image_url?: string };

type Inbound = { type?: unknown; [key: string]: unknown };

type Candidate = { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };

export type LucyHandle = {
  setState(state: LucyState): void;
  close(): void;
};

export function connectLucy(opts: {
  token: string;
  stream: MediaStream;
  initial: LucyState;
  onTrack: (stream: MediaStream) => void;
  onStatus: (status: LucyStatus, detail?: string) => void;
  onMessage: (message: unknown) => void;
}): LucyHandle {
  const ws = new WebSocket(`${LUCY_WS}?fal_jwt_token=${encodeURIComponent(opts.token)}`);
  ws.binaryType = "arraybuffer";
  let pc: RTCPeerConnection | null = null;
  let state = opts.initial;
  let closed = false;

  function send(payload: object) {
    if (ws.readyState === WebSocket.OPEN) ws.send(encode(payload));
  }

  function fail(detail: string) {
    if (closed) return;
    opts.onStatus("error", detail);
    close();
  }

  async function startPeer(iceServers: RTCIceServer[]) {
    if (pc) return;
    pc = new RTCPeerConnection({ iceServers });
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      const c: Candidate = {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
      };
      send({ type: "icecandidate", candidate: c });
    };
    pc.ontrack = (event) => {
      opts.onTrack(event.streams[0] ?? new MediaStream([event.track]));
      opts.onStatus("live");
    };
    pc.onconnectionstatechange = () => {
      if (pc?.connectionState === "failed") fail("The video connection dropped. Try going live again.");
    };
    for (const track of opts.stream.getVideoTracks()) pc.addTrack(track, opts.stream);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ type: "offer", sdp: offer.sdp });
  }

  const handlers: Record<string, (msg: Inbound) => Promise<void> | void> = {
    iceservers: (msg) =>
      startPeer(Array.isArray(msg.iceservers) && msg.iceservers.length ? (msg.iceservers as RTCIceServer[]) : FALLBACK_ICE),
    answer: async (msg) => {
      if (pc && typeof msg.sdp === "string") {
        await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
        send(state);
      }
    },
    icecandidate: async (msg) => {
      const c = msg.candidate as Candidate | undefined;
      if (pc && c?.candidate) await pc.addIceCandidate(c);
    },
    error: (msg) => fail(typeof msg.error === "string" ? msg.error : JSON.stringify(msg)),
  };

  async function readMessage(data: unknown): Promise<unknown> {
    if (typeof data === "string") {
      try {
        return JSON.parse(data);
      } catch {
        return data;
      }
    }
    if (data instanceof ArrayBuffer) return decode(new Uint8Array(data));
    if (data instanceof Blob) return decode(new Uint8Array(await data.arrayBuffer()));
    return data;
  }

  opts.onStatus("connecting");
  ws.onopen = () => {
    opts.onStatus("signalling");
    send(state);
    setTimeout(() => {
      if (!pc) fail("The try-on server took too long to warm up. Try again.");
    }, READY_TIMEOUT_MS);
  };
  ws.onmessage = async (event) => {
    const msg = await readMessage(event.data);
    opts.onMessage(msg);
    if (typeof msg !== "object" || msg === null) return;
    const inbound = msg as Inbound;
    const handler = typeof inbound.type === "string" ? handlers[inbound.type] : undefined;
    try {
      await handler?.(inbound);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  };
  ws.onerror = () => fail("Couldn't reach the live try-on server.");
  ws.onclose = (event) => {
    if (closed) return;
    if (event.code === 1000) {
      closed = true;
      opts.onStatus("closed");
      pc?.close();
    } else {
      fail(`Live session ended (${event.code}${event.reason ? `: ${event.reason}` : ""}).`);
    }
  };

  function close() {
    if (closed) return;
    closed = true;
    pc?.close();
    pc = null;
    ws.close(1000);
  }

  return {
    setState(next) {
      state = next;
      send(next);
    },
    close,
  };
}
