import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { EPPPN_RECIPES, EPPPN_RECIPE_COUNT, type Recipe } from "../../recipeData";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0" };
const respond = (body: object, status = 200) => NextResponse.json(body, {status,headers});
const norm = (v: unknown) => String(v || "").trim().toLowerCase();
const validNum = (v:unknown,max=250) => typeof v==="number" && Number.isFinite(v) && v>=0 && v<=max;
const text = (v:unknown,max=500) => String(v??"").trim().slice(0,max);

function serverClient() {
  const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url&&key ? createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}) : null;
}
async function authorize(req:Request) {
  const db=serverClient();
  if(!db)return {error:respond({error:"server_not_configured"},500)};
  const auth=req.headers.get("authorization")||"";
  const bearer=auth.startsWith("Bearer ")?auth.slice(7):"";
  if(!bearer)return {error:respond({error:"auth_required"},401)};
  const {data,error}=await db.auth.getUser(bearer);
  if(error||!data.user)return {error:respond({error:"invalid_session"},401)};
  const user=data.user, email=norm(user.email);
  const [profile,access]=await Promise.all([
    db.from("profiles").select("role").eq("user_id",user.id).maybeSingle(),
    db.from("epppn_allowed_emails").select("active,app_role,blocked_at,paused_at,access_ends_at,activated_user_id").eq("email",email).maybeSingle()
  ]);
  if(profile.error||access.error)return {error:respond({error:"access_lookup_failed"},500)};
  const admins=(process.env.ERNESTO_ADMIN_EMAILS||"").split(",").map(norm);
  const isAdmin=profile.data?.role==="admin"||access.data?.app_role==="admin"||admins.includes(email);
  const a=access.data;
  const active=a?.active===true&&!a.blocked_at&&!a.paused_at &&
    (!a.activated_user_id||a.activated_user_id===user.id) &&
    (!a.access_ends_at||new Date(a.access_ends_at)>new Date());
  if(!isAdmin&&!active)return {error:respond({error:"access_denied"},403)};
  return {db,user,isAdmin};
}
type RecipeRow={id:string;owner_id:string|null;scope:"official"|"personal";payload:Recipe};
function sanitizeRecipe(raw:unknown,id:string):Recipe|null {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;
  const o=raw as Record<string,unknown>;
  if(!text(o.name,100)||!text(o.flour,160))return null;
  if(!["froid","direct","levain"].includes(String(o.group)))return null;
  if(!["pizza","focaccia"].includes(String(o.kind))||!["pâtons","plaques"].includes(String(o.mode)))return null;
  for(const key of ["water","bassinage","salt","yeast","levain","oil","potato"]){
    if(!validNum(o[key]))return null;
  }
  if(o.levainHydration!==null&&!validNum(o.levainHydration))return null;
  const steps=Array.isArray(o.steps)?o.steps.slice(0,16).filter(s=>s&&typeof s==="object").map(s=>({
    name:text(s.name,80),detail:text(s.detail,500)
  })).filter(s=>s.name&&s.detail):[];
  if(!steps.length)return null;
  const parts=Array.isArray(o.flourParts)?o.flourParts.slice(0,10).map(p=>({
    name:text(p?.name,100),percent:Number(p?.percent)
  })):[];
  if(parts.some(p=>!p.name||!validNum(p.percent,100)))return null;
  if(parts.length && Math.abs(parts.reduce((n,p)=>n+p.percent,0)-100)>0.01)return null;
  const variants=Array.isArray(o.variants)?o.variants.slice(0,8).map(v=>({
    id:text(v?.id,80),label:text(v?.label,100),flourPerTray:Number(v?.flourPerTray),oil:Number(v?.oil)
  })):[];
  if(variants.some(v=>!v.id||!v.label||!validNum(v.flourPerTray,100000)||!validNum(v.oil)))return null;
  const optionalPositive=(key:string,max=100000)=>validNum(o[key],max)?Number(o[key]):undefined;
  const recipe:Recipe={
    id,page:validNum(o.page,10000)?Number(o.page):0,
    name:text(o.name,100),subtitle:text(o.subtitle,150),group:o.group as Recipe["group"],
    kind:o.kind as Recipe["kind"],mode:o.mode as Recipe["mode"],
    flour:text(o.flour,160),water:Number(o.water),bassinage:Number(o.bassinage),
    salt:Number(o.salt),yeast:Number(o.yeast),levain:Number(o.levain),
    levainHydration:o.levainHydration===null?null:Number(o.levainHydration),
    oil:Number(o.oil),potato:Number(o.potato),
    fermentation:text(o.fermentation,180)||"À préciser",steps,
    sourceNotes:[],caution:text(o.caution,500),bake:text(o.bake,180),
    targetDoughTemp:text(o.targetDoughTemp,80),
    flourNote:text(o.flourNote,200),sourceHydration:text(o.sourceHydration,60),
    defaultPieces:optionalPositive("defaultPieces",10000),
    pieceWeight:optionalPositive("pieceWeight",10000),
    baseFlourPerTray:optionalPositive("baseFlourPerTray"),
    baseTrayWidth:optionalPositive("baseTrayWidth",500),
    baseTrayHeight:optionalPositive("baseTrayHeight",500),
    ...(parts.length?{flourParts:parts}:{}),
    ...(variants.length?{variants}:{}),
  };
  return recipe;
}
export async function GET(req:Request){
  const auth=await authorize(req);if("error" in auth)return auth.error;
  const {data,error}=await auth.db.from("ernesto_recipe_entries")
    .select("id,owner_id,scope,payload")
    .or("scope.eq.official,owner_id.eq."+auth.user.id).limit(1000);
  if(error)return respond({error:"recipe_storage_failed"},500);
  const rows=(data||[]) as RecipeRow[];
  const overrides=new Map(rows.filter(r=>r.scope==="official").map(r=>[r.id,r.payload]));
  const official=EPPPN_RECIPES.map(r=>overrides.get(r.id)||r);
  const added=rows.filter(r=>r.scope==="official"&&!EPPPN_RECIPES.some(b=>b.id===r.id)).map(r=>r.payload);
  const personal=rows.filter(r=>r.scope==="personal"&&r.owner_id===auth.user.id).map(r=>r.payload);
  return respond({
    version:"EPPPN 2025",source_document_id:5,count:EPPPN_RECIPE_COUNT,
    officialCount:EPPPN_RECIPE_COUNT,managedCount:added.length,personalCount:personal.length,
    recipes:[...official,...added,...personal],isAdmin:auth.isAdmin
  });
}
export async function POST(req:Request){
  const auth=await authorize(req);if("error" in auth)return auth.error;
  const body=await req.json().catch(()=>null);
  if(!body||typeof body!=="object")return respond({error:"invalid_payload"},400);
  const scope=body.scope==="official"?"official":"personal";
  if(scope==="official"&&!auth.isAdmin)return respond({error:"admin_required"},403);
  const existingId=text(body.id,100);
  const ownedId=scope==="personal"&&existingId.startsWith("personal:")?existingId:
    scope==="official"&&EPPPN_RECIPES.some(r=>r.id===existingId)?existingId:
    scope==="official"&&existingId.startsWith("admin:")?existingId:"";
  const id=ownedId||(scope==="official"?"admin:":"personal:")+crypto.randomUUID();
  const recipe=sanitizeRecipe(body.recipe,id);
  if(!recipe)return respond({error:"invalid_recipe"},400);
  const db=auth.db;
  const {data:previous,error:lookupError}=await db.from("ernesto_recipe_entries")
    .select("id,scope,owner_id").eq("id",id).maybeSingle();
  if(lookupError)return respond({error:"recipe_lookup_failed"},500);
  if(previous&&(previous.scope!==scope || (scope==="personal"&&previous.owner_id!==auth.user.id)))return respond({error:"access_denied"},403);
  const record={id,scope,owner_id:scope==="personal"?auth.user.id:null,payload:recipe,updated_at:new Date().toISOString()};
  const {error}=await db.from("ernesto_recipe_entries").upsert(record,{onConflict:"id"});
  if(error)return respond({error:"recipe_write_failed"},500);
  return respond({ok:true,recipe});
}
export async function DELETE(req:Request){
  const auth=await authorize(req);if("error" in auth)return auth.error;
  const id=text(new URL(req.url).searchParams.get("id"),100);
  const scope=id.startsWith("personal:")?"personal":"official";
  if(scope==="official"&&!auth.isAdmin)return respond({error:"admin_required"},403);
  if(scope==="official"&&id.startsWith("admin:")===false&&EPPPN_RECIPES.every(r=>r.id!==id))
    return respond({error:"invalid_recipe"},400);
  let query=auth.db.from("ernesto_recipe_entries").delete().eq("id",id).eq("scope",scope);
  if(scope==="personal")query=query.eq("owner_id",auth.user.id);
  const {error}=await query;
  if(error)return respond({error:"recipe_delete_failed"},500);
  return respond({ok:true});
}
