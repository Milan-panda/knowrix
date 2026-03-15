import { Navbar } from "./(marketing)/_components/navbar";
import { Hero } from "./(marketing)/_components/hero";
import { LogosBar } from "./(marketing)/_components/logos-bar";
import { FeaturesGrid } from "./(marketing)/_components/features-grid";
import { HowItWorks } from "./(marketing)/_components/how-it-works";
import { OpenSourceCta } from "./(marketing)/_components/open-source-cta";
import { Pricing } from "./(marketing)/_components/pricing";
import { Footer } from "./(marketing)/_components/footer";
import { FadeInSection } from "./(marketing)/_components/fade-in-section";

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <Hero />
        <LogosBar />
        <FadeInSection>
          <FeaturesGrid />
        </FadeInSection>
        <FadeInSection delay={100}>
          <HowItWorks />
        </FadeInSection>
        <FadeInSection delay={150}>
          <OpenSourceCta />
        </FadeInSection>
        <FadeInSection delay={200}>
          <Pricing />
        </FadeInSection>
        <Footer />
      </main>
    </div>
  );
}
