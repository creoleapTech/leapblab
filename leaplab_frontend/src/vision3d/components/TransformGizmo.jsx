/**
 * Vision3D - Blender-Style Transform Gizmo (Zero-Lag)
 * Directly mutates Three.js objects during drag, commits to store on pointerup.
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 */

import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { use3DStore } from '../store/use3DStore';
import { renderTranslate, renderRotate, renderScale, setAxisRef } from './transformGizmo/gizmoRenderers';

const AXIS_VEC = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

let externalOrbitRef = null;
export const setOrbitRef = (ref) => { externalOrbitRef = ref; };

const TransformGizmo = () => {
  const { camera, gl, scene } = useThree();
  const selectedIds = use3DStore((s) => s.selectedIds);
  const shapes = use3DStore((s) => s.shapes);
  const updateShape = use3DStore((s) => s.updateShape);
  const pushHistory = use3DStore((s) => s.pushHistory);
  const activeTool = use3DStore((s) => s.activeTool);
  const editMode = use3DStore((s) => s.editMode);

  const [hoveredAxis, setHoveredAxis] = useState(null);
  const [dragInfo, setDragInfo] = useState(null);
  const dragRef = useRef({ active: false });
  const groupRef = useRef();

  const gizmoCenterRef = useRef(null);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  const gizmoCenter = useMemo(() => {
    if (selectedIds.length === 0) return null;
    const sel = shapes.filter((s) => selectedIds.includes(s.id));
    if (sel.length === 0) return null;
    const c = new THREE.Vector3();
    sel.forEach((s) => { c.x += s.position[0]; c.y += s.position[1]; c.z += s.position[2]; });
    c.divideScalar(sel.length);
    return c;
  }, [selectedIds, shapes]);

  gizmoCenterRef.current = gizmoCenter;

  const gizmoScale = useMemo(() => {
    if (!gizmoCenter) return 1;
    return Math.max(0.5, Math.min(3, camera.position.distanceTo(gizmoCenter) * 0.08));
  }, [gizmoCenter, camera.position]);

  // Show translate gizmo in select mode (default), otherwise match the active tool
  const mode = activeTool === 'rotate' ? 'rotate' : activeTool === 'scale' ? 'scale' : 'translate';

  const projectMouse = useCallback((clientX, clientY, axis, origin) => {
    const rect = gl.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const rc = new THREE.Raycaster();
    rc.setFromCamera(mouse, camera);
    const viewDir = new THREE.Vector3();
    camera.getWorldDirection(viewDir);
    const axisDir = AXIS_VEC[axis];
    const perp = new THREE.Vector3().crossVectors(viewDir, axisDir);
    if (perp.lengthSq() < 0.0001) {
      const fallback = new THREE.Vector3(1, 0, 0);
      if (Math.abs(axisDir.dot(fallback)) > 0.9) fallback.set(0, 0, 1);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        new THREE.Vector3().crossVectors(axisDir, fallback).normalize(), origin
      );
      const pt = new THREE.Vector3();
      const hit = rc.ray.intersectPlane(plane, pt);
      if (!hit) return null;
      return pt.clone().sub(origin).dot(axisDir);
    }
    const perp2 = new THREE.Vector3().crossVectors(axisDir, perp).normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(perp2, origin);
    const pt = new THREE.Vector3();
    const hit = rc.ray.intersectPlane(plane, pt);
    if (!hit) return null;
    return pt.clone().sub(origin).dot(axisDir);
  }, [camera, gl]);

  const projectRotationAngle = useCallback((clientX, clientY, axis, origin) => {
    const rect = gl.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const rc = new THREE.Raycaster();
    rc.setFromCamera(mouse, camera);
    const axisDir = AXIS_VEC[axis];
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisDir, origin);
    const pt = new THREE.Vector3();
    const hit = rc.ray.intersectPlane(plane, pt);
    if (!hit) return null;
    const v = pt.clone().sub(origin);
    if (axis === 'x') {
      return Math.atan2(v.z, v.y);
    } else if (axis === 'y') {
      return Math.atan2(v.x, v.z);
    } else {
      return Math.atan2(v.y, v.x);
    }
  }, [camera, gl]);

  const hitTestGizmo = useCallback((clientX, clientY) => {
    const group = groupRef.current;
    if (!group) return null;
    const rect = gl.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const rc = new THREE.Raycaster();
    rc.setFromCamera(mouse, camera);
    const targets = [];
    group.traverse((child) => {
      if (child.isMesh && child.userData.gizmoAxis) targets.push(child);
    });
    if (targets.length === 0) return null;
    const intersects = rc.intersectObjects(targets, false);
    if (intersects.length === 0) return null;
    return intersects[0].object.userData.gizmoAxis;
  }, [camera, gl]);

  useEffect(() => {
    if (!gl) return;
    // Don't attach gizmo event listener in edit mode — MeshEditor handles clicks there
    if (editMode !== 'object') return;
    const canvas = gl.domElement;

    const renderFrame = () => { gl.render(scene, camera); };

    const handleDown = (e) => {
      const currentGizmoCenter = gizmoCenterRef.current;
      const currentSelectedIds = selectedIdsRef.current;
      if (!currentGizmoCenter || currentSelectedIds.length === 0) return;
      if (dragRef.current.active) return;

      const axis = hitTestGizmo(e.clientX, e.clientY);
      if (!axis) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      window.__gizmoActive = true;

      // ── Take over rendering ──────────────────────────────
      gl.setAnimationLoop(null);
      const prevPixelRatio = gl.getPixelRatio();
      gl.setPixelRatio(1);
      const prevShadowEnabled = gl.shadowMap?.enabled;
      if (gl.shadowMap) gl.shadowMap.enabled = false;

      const store = use3DStore.getState();
      // In select mode, default to translate (move)
      const curMode = store.activeTool === 'rotate' ? 'rotate' : store.activeTool === 'scale' ? 'scale' : 'translate';
      const ids = store.selectedIds;
      const allShapes = store.shapes;
      const sel = allShapes.filter((s) => ids.includes(s.id));
      const gSnap = store.gridSnap;
      const rSnap = store.rotationSnap;
      const origin = currentGizmoCenter.clone();
      const startX = e.clientX;
      const startY = e.clientY;
      const snapVal = (v, s) => s > 0 ? Math.round(v / s) * s : v;
      const snapAng = (v, deg) => deg > 0 ? Math.round(v / (deg * Math.PI / 180)) * (deg * Math.PI / 180) : v;

      // Snapshot + find meshes
      const startPosMap = new Map();
      const startRotMap = new Map();
      const startScaleMap = new Map();
      const meshes = [];
      const meshIdx = new Map();
      let idx = 0;

      scene?.traverse?.((child) => {
        if (child.isMesh && child.userData.shapeId && ids.includes(child.userData.shapeId)) {
          meshes.push(child);
          meshIdx.set(child.userData.shapeId, idx++);
        }
      });

      sel.forEach((s) => {
        startPosMap.set(s.id, [...s.position]);
        startRotMap.set(s.id, [...s.rotation]);
        startScaleMap.set(s.id, [...s.scale]);
      });

      let activated = false;
      let startProjected = 0;
      let renderQueued = false;
      const queueRender = () => {
        if (!renderQueued) {
          renderQueued = true;
          requestAnimationFrame(() => { renderQueued = false; renderFrame(); });
        }
      };

      const onMove = (ev) => {
        const d = dragRef.current;

        if (!activated) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3) return;
          activated = true;
          d.active = true;
          d.axis = axis;
          d.mode = curMode;
          d.origin = origin;
          d.startMouse = { x: startX, y: startY };
          d.lastDelta = 0;
          if (curMode === 'rotate') {
            startProjected = projectRotationAngle(startX, startY, axis, origin) || 0;
          } else {
            startProjected = projectMouse(startX, startY, axis, origin) || 0;
          }
          setDragInfo({ axis, mode: curMode, value: 0 });
          if (externalOrbitRef?.current) externalOrbitRef.current.enabled = false;
          canvas.style.cursor = 'grabbing';
        }

        if (!d.active) return;

        if (curMode === 'translate') {
          let current = projectMouse(ev.clientX, ev.clientY, axis, origin);
          if (current === null) return;
          let delta = current - startProjected;
          d.lastDelta = delta;
          const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
          for (let i = 0; i < meshes.length; i++) {
            const mesh = meshes[i];
            const id = mesh.userData.shapeId;
            const sp = startPosMap.get(id);
            if (!sp) return;
            const val = sp[idx] + delta;
            if (idx === 0) mesh.position.x = val;
            else if (idx === 1) mesh.position.y = val;
            else mesh.position.z = val;
          }
        } else if (curMode === 'rotate') {
          let current = projectRotationAngle(ev.clientX, ev.clientY, axis, origin);
          if (current === null) return;
          let diff = current - startProjected;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          
          let angle = snapAng(diff, rSnap);
          d.lastDelta = angle;
          const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
          for (let i = 0; i < meshes.length; i++) {
            const mesh = meshes[i];
            const id = mesh.userData.shapeId;
            const sr = startRotMap.get(id);
            if (!sr) return;
            mesh.rotation.x = idx === 0 ? sr[0] + angle : sr[0];
            mesh.rotation.y = idx === 1 ? sr[1] + angle : sr[1];
            mesh.rotation.z = idx === 2 ? sr[2] + angle : sr[2];
          }
        } else if (curMode === 'scale') {
          const movement = axis === 'y' ? -(ev.clientY - startY) : ev.clientX - startX;
          let factor = Math.round(Math.max(0.05, 1 + movement * 0.003) / 0.05) * 0.05;
          d.lastDelta = factor;
          const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
          for (let i = 0; i < meshes.length; i++) {
            const mesh = meshes[i];
            const id = mesh.userData.shapeId;
            const ss = startScaleMap.get(id);
            if (!ss || ss.length <= idx) return;
            const val = Math.max(0.001, ss[idx] * factor);
            if (idx === 0) mesh.scale.x = val;
            else if (idx === 1) mesh.scale.y = val;
          }
        }

        // Directly update gizmo group position to follow the moved meshes
        if (groupRef.current && meshes.length > 0) {
          const newCenter = new THREE.Vector3();
          for (let i = 0; i < meshes.length; i++) {
            newCenter.add(meshes[i].position);
          }
          newCenter.divideScalar(meshes.length);
          groupRef.current.position.copy(newCenter);
        }

        queueRender();
      };

      function restoreState() {
        gl.setPixelRatio(prevPixelRatio);
        if (gl.shadowMap) gl.shadowMap.enabled = prevShadowEnabled;
      }

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const d = dragRef.current;
        dragRef.current.active = false;
        setDragInfo(null);
        window.__gizmoActive = false;
        if (externalOrbitRef?.current) externalOrbitRef.current.enabled = true;
        canvas.style.cursor = 'auto';

        if (activated) {
          // Commit final state to store (with snap)
          const curStore = use3DStore.getState();
          const axisIdx = d.axis === 'x' ? 0 : d.axis === 'y' ? 1 : 2;
          const delta = d.lastDelta;
          for (let i = 0; i < meshes.length; i++) {
            const mesh = meshes[i];
            const id = mesh.userData.shapeId;
            const sr = startRotMap.get(id);
            let finalRot = [...sr];
            if (d.mode === 'rotate') {
              finalRot[axisIdx] = sr[axisIdx] + delta;
            }
            curStore.updateShape(id, {
              position: [
                snapVal(mesh.position.x, gSnap),
                mesh.position.y,
                snapVal(mesh.position.z, gSnap),
              ],
              rotation: finalRot,
              scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
            });
          }
          pushHistory();
        }

        restoreState();
        renderFrame();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };

    canvas.addEventListener('pointerdown', handleDown, { capture: true });
    return () => canvas.removeEventListener('pointerdown', handleDown, { capture: true });
  }, [gl, scene, camera, editMode, hitTestGizmo, projectMouse, projectRotationAngle, pushHistory, updateShape]);

  useEffect(() => () => {
    if (externalOrbitRef?.current) externalOrbitRef.current.enabled = true;
  }, []);

  const onHover = useCallback((ax) => {
    setHoveredAxis(ax);
    gl.domElement.style.cursor = 'grab';
  }, [gl]);

  const onUnhover = useCallback(() => {
    setHoveredAxis(null);
    if (!dragRef.current.active) gl.domElement.style.cursor = 'auto';
  }, [gl]);

  if (editMode !== 'object' || !gizmoCenter || selectedIds.length === 0) return null;

  const col = (ax) => dragInfo?.axis === ax ? '#ff6666' : hoveredAxis === ax ? '#ff6666' : ax === 'x' ? '#ef4444' : ax === 'y' ? '#22c55e' : '#3b82f6';

  return (
    <group ref={groupRef} position={gizmoCenter.toArray()}>
      {mode === 'translate' && renderTranslate(gizmoScale, col, onHover, onUnhover)}
      {mode === 'rotate' && renderRotate(gizmoScale, col, onHover, onUnhover)}
      {mode === 'scale' && renderScale(gizmoScale, col, onHover, onUnhover)}
    </group>
  );
};

export default TransformGizmo;
