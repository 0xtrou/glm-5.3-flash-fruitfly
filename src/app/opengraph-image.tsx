import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "FLYTAPE — two trained fly brains generating live music";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(135deg, #05080f 0%, #0a1428 55%, #101c3a 100%)",
          padding: "72px 88px",
          position: "relative",
        }}
      >
        {/* glow blobs */}
        <div
          style={{
            position: "absolute",
            top: -180,
            left: 340,
            width: 620,
            height: 620,
            borderRadius: 999,
            background: "radial-gradient(circle, rgba(52,211,153,0.22) 0%, rgba(52,211,153,0) 70%)",
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -220,
            right: -140,
            width: 560,
            height: 560,
            borderRadius: 999,
            background: "radial-gradient(circle, rgba(168,85,247,0.18) 0%, rgba(168,85,247,0) 70%)",
            display: "flex",
          }}
        />

        {/* header row: logo mark + wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div
            style={{
              width: 118,
              height: 118,
              borderRadius: 30,
              background: "linear-gradient(135deg, #101c3a 0%, #05080f 100%)",
              border: "3px solid rgba(94,234,212,0.65)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 60px rgba(52,211,153,0.35)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 26, height: 26, borderRadius: 99, background: "#ff5c5c", display: "flex" }} />
              <div style={{ width: 26, height: 26, borderRadius: 99, background: "#c084fc", display: "flex" }} />
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                fontSize: 78,
                fontWeight: 900,
                color: "#5eead4",
                letterSpacing: "-0.02em",
                textShadow: "0 0 34px rgba(52,211,153,0.55)",
                display: "flex",
              }}
            >
              FLYTAPE
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: "#94a3b8", display: "flex", letterSpacing: "0.08em" }}>
              CONNECTOME &gt; FLY &gt; DECKS &gt; BANGER
            </div>
          </div>
        </div>

        {/* headline */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: 64 }}>
          <div style={{ fontSize: 56, fontWeight: 900, color: "#f1f5f9", display: "flex" }}>
            Two trained fly brains. One live set.
          </div>
          <div style={{ marginTop: 18, fontSize: 30, color: "#7dd3c8", display: "flex" }}>
            Every note is a real spike from spiking networks wired on actual
          </div>
          <div style={{ fontSize: 30, color: "#7dd3c8", display: "flex" }}>
            Drosophila neuron reconstructions — zero scripted notes.
          </div>
        </div>

        {/* footer chips */}
        <div style={{ display: "flex", gap: 18, marginTop: "auto" }}>
          {["140,024-neuron model", "R-STDP trained", "100% brain-generated"].map((chip) => (
            <div
              key={chip}
              style={{
                display: "flex",
                padding: "12px 26px",
                borderRadius: 999,
                border: "1px solid rgba(94,234,212,0.35)",
                color: "#a7f3d0",
                fontSize: 24,
                fontWeight: 700,
              }}
            >
              {chip}
            </div>
          ))}
        </div>

        <div
          style={{
            position: "absolute",
            bottom: 34,
            right: 88,
            fontSize: 22,
            color: "#475569",
            display: "flex",
          }}
        >
          flytape.solo.engineer
        </div>
      </div>
    ),
    size
  );
}
