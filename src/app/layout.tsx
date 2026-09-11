import type { Metadata } from "next";
import { Be_Vietnam_Pro, Geist_Mono } from "next/font/google";
import "./globals.css";

const beVietnam = Be_Vietnam_Pro({
  variable: "--font-sans",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://flytape.solo.engineer"),
  title: {
    default: "FLYTAPE — Two Trained Fly Brains Generating Live Music",
    template: "%s · FLYTAPE",
  },
  description:
    "DJ FLYWIRE × MC JANELIA: two spiking neural networks built on real Drosophila neuron reconstructions, trained with reward-modulated STDP, generating every note of their live set from their own spikes. 100% brain-generated, zero scripted notes.",
  keywords: [
    "fly brain",
    "fruit fly connectome",
    "spiking neural network",
    "neural sonification",
    "generative music",
    "R-STDP",
    "FlyWire",
    "NeuroMorpho",
    "three.js",
    "Web Audio",
  ],
  authors: [{ name: "The Connectome Crew" }],
  openGraph: {
    type: "website",
    url: "https://flytape.solo.engineer",
    siteName: "FLYTAPE",
    title: "FLYTAPE — Two Trained Fly Brains Generating Live Music",
    description:
      "Real fly-neuron wiring + reward-modulated STDP = two brains that learned to play. Every note is a spike. Zero scripted notes.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "FLYTAPE — two trained fly brains playing live" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "FLYTAPE — Two Trained Fly Brains Generating Live Music",
    description:
      "Spiking networks on real Drosophila morphology, trained with R-STDP, playing a live set from their own spikes.",
    images: ["/opengraph-image"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${beVietnam.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
