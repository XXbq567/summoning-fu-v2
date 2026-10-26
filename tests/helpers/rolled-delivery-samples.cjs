'use strict';
const contract=require('../../scripts/qa-delivery-contract.cjs');
function samples(){
 const specs=[[0,'point'],[1000,'unfold'],[2500,'writing'],[4200,'hold'],[4700,'hold'],[5200,'hold'],[5700,'hold'],[6100,'hold'],
 [6250,'rolling',.03],[6500,'rolling',.35],[6800,'rolling',.8],[6950,'rolling',.99],
 [7050,'rotating',.2],[7150,'rotating',.6],[7300,'flying',.12],[7500,'flying',.4],[7750,'flying',.8],[8000,'staging'],
 [8080,'intake',.05],[8180,'intake',.38],[8280,'intake',.72],[8340,'intake',.92],[8400,'hidden'],[9300,'hidden']];
 return specs.map(([t,phase,q=0],i)=>{
  const active=contract.activePhases.includes(phase),hidden=phase==='hidden',rot=phase==='rolling'?0:phase==='rotating'?q:active||hidden?1:0,fr=phase==='rolling'?q:active||hidden?1:0;
  const pos={x:phase==='flying'?180+220*q:active&&phase!=='rolling'&&phase!=='rotating'?400:180,y:phase==='rolling'?100:phase==='rotating'?100-12*q:phase==='flying'?100+400*q:phase==='intake'?500+400*q**4:500},angle=rot*Math.PI/2;
  const bounds={x:pos.x-100,y:phase==='rolling'?100+(1.2-710/264/2)*200:pos.y-100,width:200,height:200};
  const remaining=phase==='intake'?Math.max(0,Math.min(bounds.height,650-bounds.y)):bounds.height;
  const d={deliveryMode:'rolled-paper',deliveryPhase:active?phase:hidden?'hidden':'none',rollProgress:1-fr,rollFraction:fr,actualWoundFraction:fr,rollRadius:.025+.14*fr,rotationProgress:rot,deliveryRotationZ:angle,
   deliveryMeshId:'one-real-mesh',deliveryGeometryId:'one-real-geometry',deliveryUvHash:'uv-original',deliveryUvInitialHash:'uv-original',deliveryGeometryPositionHash:phase==='rolling'?'actual-positions-'+q:'actual-rolled',
   deliveryPivotLocal:{x:0,y:1.2,z:.1},deliverySourcePivot:{x:180,y:100},deliveryPosition:pos,deliveryBounds:bounds,
   visibleGeometryBounds:remaining>0?{...bounds,height:remaining}:null,deliveryVisibleVertexCount:Math.ceil(1737*remaining/bounds.height),deliveryClipIntersectionCount:remaining>0&&remaining<bounds.height?4:0,visibleGeometryBoundsSource:'cpu-clipped-indexed-triangles',
   projectedAxis:{leading:{x:pos.x+100*Math.cos(angle),y:pos.y+100*Math.sin(angle)},trailing:{x:pos.x-100*Math.cos(angle),y:pos.y-100*Math.sin(angle)}},
   flightProgress:phase==='flying'?q:phase==='staging'||phase==='intake'||hidden?1:0,intakeProgress:phase==='intake'?q:hidden?1:0,
   intakeLeadingY:phase==='intake'?pos.y+100:null,intakeTrailingY:phase==='intake'?pos.y-100:null,intakePlaneY:phase==='intake'?650:null,
   deliveryTargetId:'preview-right',deliveryTargetValid:active,deliveryClipped:phase==='intake',backsideInkStrength:.2,materialAdapter:'paper-backface-v1',material:{opacity:1,forceSinglePass:true,depthTest:true,depthWrite:true,clippingPlanes:phase==='intake'?[{normal:[0,1,0],constant:100}]:[]}};
  const draw=t<1950?2:t<6150?40:hidden?160:45+i*4;
  const p={...d,engine:'paperlab',libraryVersion:'0.8.1',materialReady:true,error:null,canvasVisible:phase==='point'||phase==='unfold'||active,actualDrawCount:draw,actualClearCount:hidden?1:0,metadataHash:'1234abcd',textureHash:'abcdef12',textureRasterizations:5,flameCount:0};
  return {at:new Date(1700000000000+t).toISOString(),captureStatus:{},preview:{visible:true,evidence:{phase,generation:2,elapsedMs:t,playing:!hidden,svgVisible:phase==='writing'||phase==='hold',writing:t<1950?0:t<4150?.5:1,burn:0,visibleGlyphs:t<1950?0:t<4150?10:20,totalGlyphs:20,holdStartMs:4150,leaveAtMs:6150,hideAtMs:8400,rafCount:draw,paperlab:p}}};
 });
}
module.exports={samples};
