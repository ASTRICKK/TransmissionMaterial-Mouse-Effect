import "./page.css";
import MouseFluid from "@/components/canvas/MouseFluid/MouseFluid";
import VelocityPaintRefract from "@/components/canvas/VelocityPaint/VelocityPaintRefract";
import VelocityPaintIridescence from "@/components/canvas/VelocityPaint/VelocityPaintIridescence";
import VelocityPaintOil from "@/components/canvas/VelocityPaint/VelocityPaintOil";
import FluidPhysicPaintWater from "@/components/canvas/FluidPhysicPaintWater/FluidPhysicPaintWater";

export default function Home() {
  return (
    <div className="main">
      {/* <MouseFluid /> */}
      {/* <VelocityPaintRefract /> */}
      {/* <VelocityPaintIridescence /> */}
      {/* <VelocityPaintOil /> */}
      <FluidPhysicPaintWater />
    </div>
  );
}
