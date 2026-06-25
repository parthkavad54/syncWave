import React, { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sphere, MeshDistortMaterial, Float, Box, Torus } from "@react-three/drei";
import * as THREE from "three";

function WaveSphere() {
  const meshRef = useRef<THREE.Mesh>(null!);
  
  useFrame((state) => {
    const time = state.performance.current / 1000;
    meshRef.current.rotation.x = time * 0.1;
    meshRef.current.rotation.y = time * 0.15;
    
    // Read visualizer data from the window object (populated by Web Worker)
    const visualizerData = (window as any).__visualizerData;
    const bassScale = visualizerData ? visualizerData.bassScale : 0;
    
    // Pulse effect + audio bass reactivity
    const baseScale = 1 + Math.sin(time * 2) * 0.05;
    const audioScale = baseScale + (bassScale * 0.5); // Add up to 0.5x scale on heavy bass
    meshRef.current.scale.set(audioScale, audioScale, audioScale);
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

function Particles({ theme }: { theme: string }) {
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
    
    // Read visualizer data from the window object (populated by Web Worker)
    const visualizerData = (window as any).__visualizerData;
    const trebleShift = visualizerData ? visualizerData.trebleShift : 0;
    
    // Fast rotation when treble is high
    pointsRef.current.rotation.y = time * (0.03 + trebleShift * 0.2);
    // Vertical oscillation boosted by treble
    pointsRef.current.position.y = Math.sin(time * 0.5) * 0.2 + (trebleShift * 1.5);
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
        color={theme === "light" ? "#0A0A0F" : "#ffffff"}
        transparent
        opacity={0.4}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function Bars() {
  const count = 32;
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    const time = state.performance.current / 1000;
    const visualizerData = (window as any).__visualizerData;
    const data = visualizerData ? visualizerData.raw : new Array(count).fill(0);

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const radius = 5;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      
      const v = data[i] || 0;
      const scaleY = 0.1 + (v / 255) * 8;
      
      dummy.position.set(x, scaleY / 2 - 2, z);
      dummy.lookAt(0, dummy.position.y, 0);
      dummy.scale.set(0.5, scaleY, 0.2);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    meshRef.current.rotation.y = time * 0.1;
  });

  return (
    <instancedMesh ref={meshRef} args={[null as any, null as any, count]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#06B6D4" emissive="#7C3AED" emissiveIntensity={0.5} wireframe />
    </instancedMesh>
  );
}

function Rings() {
  const groupRef = useRef<THREE.Group>(null!);

  useFrame((state) => {
    const time = state.performance.current / 1000;
    const visualizerData = (window as any).__visualizerData;
    const bassScale = visualizerData ? visualizerData.bassScale : 0;
    
    groupRef.current.rotation.x = Math.sin(time * 0.2) * 0.5;
    groupRef.current.rotation.y = time * 0.1;

    groupRef.current.children.forEach((child, i) => {
      const scale = 1 + (bassScale * 0.2 * (i + 1));
      child.scale.set(scale, scale, scale);
      child.rotation.x = time * 0.5 * (i % 2 === 0 ? 1 : -1);
      child.rotation.y = time * 0.3 * (i % 2 === 0 ? -1 : 1);
    });
  });

  return (
    <group ref={groupRef}>
      {[0, 1, 2].map((i) => (
        <Torus key={i} args={[2 + i * 1.5, 0.05, 16, 100]}>
          <meshBasicMaterial color={i % 2 === 0 ? "#7C3AED" : "#06B6D4"} wireframe />
        </Torus>
      ))}
    </group>
  );
}

export default function ThreeBackground({ mode = "particles", theme = "dark" }: { mode?: string, theme?: string }) {
  return (
    <div className="fixed inset-0 -z-10 pointer-events-none">
      <Canvas camera={{ position: [0, 0, 5], fov: 75 }}>
        <ambientLight intensity={theme === "light" ? 1 : 0.5} />
        <pointLight position={[10, 10, 10]} intensity={1} color="#7C3AED" />
        <pointLight position={[-10, -10, -10]} intensity={0.5} color="#06B6D4" />
        
        {mode === "particles" && (
          <>
            <Float speed={1.5} rotationIntensity={1} floatIntensity={2}>
              <WaveSphere />
            </Float>
            <Particles theme={theme} />
          </>
        )}
        
        {mode === "bars" && <Bars />}
        {mode === "rings" && <Rings />}
        
        <fog attach="fog" args={[theme === "light" ? "#F8FAFC" : "#0A0A0F", 5, 15]} />
      </Canvas>
    </div>
  );
}
