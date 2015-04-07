#version 450 core
#extension GL_NV_shader_atomic_float : require

#include "globalubos.glsl"
#include "lightcache.glsl"
#include "gbuffer.glsl"
#include "utils.glsl"

layout(location = 0) in vec3 gs_out_Normal;
layout(location = 1) in vec2 gs_out_Texcoord;
layout(location = 2) in flat int gs_out_SideIndex;
layout(location = 3) in flat vec4 gs_out_RasterAABB;

layout(binding = 0, r8ui) restrict writeonly uniform uimage3D VoxelVolume;

ivec3 UnswizzlePos(ivec3 pos)
{
	return gs_out_SideIndex == 0 ? pos.zyx : (gs_out_SideIndex == 1 ? pos.xzy : pos.xyz);
}

void RecordCache(ivec3 voxelPos)
{
	int cachePositionInt;
	int cacheIndex = GetCacheHash(voxelPos, cachePositionInt);

	// If no position was written to this cache, change position.
	int oldCachePosition = atomicCompSwap(LightCacheEntries[cacheIndex].Position, 0, cachePositionInt+1);

	#ifdef LIGHTCACHE_CREATION_STATS
		if(oldCachePosition == 0)
		{
			atomicAdd(LightCacheActiveCount, 1);
		}
	#endif

	// Already used and not this position
	while(oldCachePosition != cachePositionInt+1 && oldCachePosition != 0)
	{
		#ifdef LIGHTCACHE_CREATION_STATS
			atomicAdd(LightCacheHashCollisionCount, 1);
		#endif

		cacheIndex = (cacheIndex + 1) % MaxNumLightCaches;
		oldCachePosition = atomicCompSwap(LightCacheEntries[cacheIndex].Position, 0, cachePositionInt+1);
	}

	atomicAdd(LightCacheEntries[cacheIndex].Normal.x, gs_out_Normal.x);
	atomicAdd(LightCacheEntries[cacheIndex].Normal.y, gs_out_Normal.y);
	atomicAdd(LightCacheEntries[cacheIndex].Normal.z, gs_out_Normal.z);
}

void StoreVoxelAndCache(ivec3 voxelPosSwizzledI)
{
	ivec3 voxelPos = UnswizzlePos(voxelPosSwizzledI);
	/*uint oldVoxelValue = imageLoad(VoxelVolume, voxelPos).r;

	// Store cache only if a cache is ordered
	if((oldVoxelValue & CACHE_NEEDED_BIT) != 0)
	{
		RecordCache(voxelPos);
	}
	// Store voxel only if there is not already one (needed to read it anyways)
	if((oldVoxelValue & SOLID_BIT) == 0) // Branch helpful?
	{*/
		imageStore(VoxelVolume, voxelPos, uvec4(SOLID_BIT));//uvec4(oldVoxelValue | SOLID_BIT));
	//}
}

void main()
{
	// Clip pixels outside of conservative raster AABB
	if(any(lessThan(gl_FragCoord.xy, gs_out_RasterAABB.xy)) || any(greaterThan(gl_FragCoord.xy, gs_out_RasterAABB.zw)))
	{
		return; // Same as discard here.
	}
	
	// Retrieve voxel pos from gl_FragCoord
	// Attention: This voxel pos is still swizzled!
	vec3 voxelPosSwizzled;
	voxelPosSwizzled.xy = gl_FragCoord.xy;
	voxelPosSwizzled.z = gl_FragCoord.z*VoxelResolution;
	ivec3 voxelPosSwizzledI = ivec3(voxelPosSwizzled + vec3(0.5));

	StoreVoxelAndCache(voxelPosSwizzledI);

	// "Depth Conservative"
	float depthDx = dFdxCoarse(voxelPosSwizzled.z);
	float depthDy = dFdyCoarse(voxelPosSwizzled.z);
	float maxChange = length(vec2(depthDx, depthDy)) * 1.414; //inversesqrt(2);

	float minDepth = voxelPosSwizzled.z - maxChange;
	float maxDepth = voxelPosSwizzled.z + maxChange;

	int minDepthVoxel = int(minDepth * VoxelResolution + vec3(0.5));
	int maxDepthVoxel = int(maxDepth * VoxelResolution + vec3(0.5));

	if(voxelPosSwizzledI.z != minDepthVoxel)
	{
		ivec3 voxelPosMin = voxelPosSwizzledI;
		voxelPosMin -= 1;
		StoreVoxelAndCache(voxelPosMin);
	}
	if(voxelPosSwizzledI.z != maxDepthVoxel)
  	{
  		ivec3 voxelPosMax = voxelPosSwizzledI;
		voxelPosMax.z += 1;
  		StoreVoxelAndCache(voxelPosMax);
  	}
}