import "./page.css";
import MouseFluid from "@/components/canvas/MouseFluid/MouseFluid";
import VelocityPaintRefract from "@/components/canvas/VelocityPaint/VelocityPaintRefract";
import VelocityPaintShimmer from "@/components/canvas/VelocityPaint/VelocityPaintShimmer";

export default function Home() {
  return (
    <div className="main">
      {/* <MouseFluid /> */}
      <VelocityPaintRefract />
      {/* <VelocityPaintShimmer /> */}
    </div>
  );
}
