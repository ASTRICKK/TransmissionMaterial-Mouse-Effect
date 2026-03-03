import "./page.css";
import MouseFluid from "@/components/canvas/MouseFluid/MouseFluid";
import VelocityPaint from "@/components/canvas/VelocityPaint/VelocityPaint";

export default function Home() {
  return (
    <div className="main">
      <MouseFluid />
      <VelocityPaint />
    </div>
  );
}
