/**
 * Vision3D - Shape Renderer Component
 * Renders shape meshes, handles hover cursor, tags meshes for raycasting.
 * All drag/click handled by ShapeInteraction (DOM capture).
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 */

import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { createGeometry } from '../utils/geometry';
import { use3DStore } from '../store/use3DStore';

const setShapeIdRef = (id) => (mesh) => {
  if (mesh) mesh.userData.shapeId = id;
};

export const ShapeRenderer = ({ shape }) => {
  const selectedIds = use3DStore((s) => s.selectedIds);
  const editMode = use3DStore((s) => s.editMode);
  const editShapeId = use3DStore((s) => s.editShapeId);
  const isSelected = selectedIds.includes(shape.id);
  const isEdited = editMode !== 'object' && editShapeId === shape.id;

  const geometry = useMemo(() => {
    // Use createGeometry so serialized (_csgGeometry as Record) is deserialized and cloned safely
    // Directly returning shape._csgGeometry when it's a Record causes "dispose is not a function" and missing bounding volumes
    const geo = createGeometry(shape);
    // Ensure frustum culling has required bounds (fixes "Cannot read properties of undefined (reading 'center')" after undo/CSG)
    if (geo && !geo.boundingSphere) geo.computeBoundingSphere();
    if (geo && !geo.boundingBox) geo.computeBoundingBox();
    if (geo && geo.attributes && !geo.attributes.normal) geo.computeVertexNormals();
    return geo;
  }, [
    shape._customGeometry, shape._csgGeometry,
    shape.type, shape.width, shape.height, shape.depth, shape.cornerRadius,
    shape.radiusTop, shape.radiusBottom, shape.cylinderHeight, shape.radialSegments,
    shape.radius, shape.widthSegments, shape.heightSegments,
    shape.coneRadius, shape.coneHeight,
    shape.torusRadius, shape.tubeRadius, shape.torusRadialSegments, shape.torusTubularSegments,
    shape.innerRadius, shape.outerRadius,
    shape.roofWidth, shape.roofDepth, shape.roofHeight,
    shape.roundRoofWidth, shape.roundRoofDepth, shape.roundRoofHeight,
    shape.wedgeWidth, shape.wedgeDepth, shape.wedgeHeight,
    shape.pyramidRadius, shape.pyramidHeight, shape.pyramidSides,
    shape.halfSphereRadius, shape.halfSphereSegments,
    shape.paraboloidRadius, shape.paraboloidHeight, shape.paraboloidSegments,
    shape.tubeOuterRadius, shape.tubeInnerRadius, shape.tubeHeight, shape.tubeRadialSegments,
    shape.starOuterRadius, shape.starInnerRadius, shape.starPoints, shape.starHeight,
    shape.polygonRadius, shape.polygonSides, shape.polygonHeight,
    shape.text, shape.fontSize, shape.textDepth,
  ]);

  const material = useMemo(() => {
    const isHole = shape.isHole;
    const color = isHole ? '#888888' : shape.color;
    const isCSG = shape.type === 'csg_result' || !!shape._csgGeometry;
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      metalness: shape.metalness ?? 0.1,
      roughness: shape.roughness ?? 0.7,
      transparent: isHole || (shape.opacity ?? 1) < 1,
      opacity: isHole ? 0.4 : (shape.opacity ?? 1),
      side: isCSG ? THREE.DoubleSide : THREE.FrontSide,
      wireframe: isHole,
    });
  }, [shape.color, shape.isHole, shape.metalness, shape.roughness, shape.opacity, shape.type, shape._csgGeometry]);

  useEffect(() => {
    return () => {
      // Only dispose if it's a real BufferGeometry with dispose (cloned geo from createGeometry)
      if (geometry && typeof geometry.dispose === 'function') {
        geometry.dispose();
      }
      material.dispose();
    };
  }, [geometry, material]);

  if (!shape.visible) return null;

  return (
    <mesh
      ref={setShapeIdRef(shape.id)}
      geometry={geometry}
      material={material}
      position={shape.position}
      rotation={shape.rotation}
      scale={shape.scale}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
      onPointerOut={(e) => { e.stopPropagation(); document.body.style.cursor = 'auto'; }}
      castShadow
      receiveShadow
    >
      {isSelected && !isEdited && (
        <mesh scale={[1.02, 1.02, 1.02]} geometry={geometry}>
          <meshBasicMaterial color="#6366f1" wireframe transparent opacity={0.5} />
        </mesh>
      )}
    </mesh>
  );
};
