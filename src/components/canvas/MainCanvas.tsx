'use client'

import { Canvas } from "@react-three/fiber"

export default function MainCanvas({children, className}: {children: React.ReactNode, className: string}) {
    return (
        <Canvas className={className}>
            {children}
        </Canvas>
    )
}