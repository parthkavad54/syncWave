import React, { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sphere, MeshDistortMaterial, Float } from "@react-three/drei";
import * as THREE from "three";

function WaveSphere() {
  const meshRef = useRef<THREE.Mesh>(null!);
  
  useFrame((state) => {
    const time = state.performance.current / 1000;
    meshRef.current.rotation.x = time * 0.1;
    meshRef.current.rotation.y = time * 0.15;
    
    // Pulse effect
    const scale = 1 + Math.sin(time * 2) * 0.05;
    meshRef.current.scale.set(scale, scale, scale);
  });

  return (
    <Sphere args={[1, 64, 64]} ref={meshRef}>
      <MeshDistortMaterial
        color="#7C3AED"
        speed={1.5}
        distort={0.4}
        radius={1}
        emissive="#06B6D4"
        emissiveIntensity={0.2}
      />
    </Sphere>
  );
}

function Particles() {
  const count = 1000;
  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 15;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 15;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 15;
    }
    return pos;
  }, []);

  const pointsRef = useRef<THREE.Points>(null!);

  useFrame((state) => {
    const time = state.performance.current / 1000;
    pointsRef.current.rotation.y = time * 0.03;
    // Slight vertical oscillation
    pointsRef.current.position.y = Math.sin(time * 0.5) * 0.2;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.03}
        color="#ffffff"
        transparent
        opacity={0.4}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

export default function ThreeBackground() {
  return (
    <div className="fixed inset-0 -z-10 pointer-events-none">
      <Canvas camera={{ position: [0, 0, 5], fov: 75 }}>
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} intensity={1} color="#7C3AED" />
        <pointLight position={[-10, -10, -10]} intensity={0.5} color="#06B6D4" />
        
        <Float speed={1.5} rotationIntensity={1} floatIntensity={2}>
          <WaveSphere />
        </Float>
        
        <Particles />
        
        <fog attach="fog" args={["#0A0A0F", 5, 15]} />
      </Canvas>
    </div>
  );
}
