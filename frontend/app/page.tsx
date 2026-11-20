import { Features } from "@/app/components/landing/Features";
import { Footer } from "@/app/components/landing/Footer";
import { Header } from "@/app/components/landing/Header";
import { Hero } from "@/app/components/landing/Hero";
import { Pricing } from "@/app/components/landing/Pricing";

export default function Landing() {
  return (
    <div className="min-h-screen">
      <Header />
      <Hero />
      <Features />
      <Pricing />
      <Footer />
    </div>
  );
}
