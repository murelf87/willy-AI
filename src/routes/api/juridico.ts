import { createFileRoute } from "@tanstack/react-router";
import { blockForeignSite } from "@/lib/same-origin";
import {
  getBoeAuxTable, getBoeDailySummary, getBoeLegislationText, getBojaDisposition, getEuDocumentByCelex,
  legalServerStatus, loadLegalCases, officialLegalLinks, saveLegalCases, searchBoeLegislation, searchBoja,
  searchEuCaseLaw, searchEuLegislation,
} from "@/lib/juridico-server";

export const Route = createFileRoute("/api/juridico")({
  server: { handlers: {
    GET: async ({ request }) => {
      const blocked=blockForeignSite(request); if(blocked)return blocked;
      return Response.json({ok:true,status:legalServerStatus()},{headers:{"Cache-Control":"no-store"}});
    },
    POST: async ({ request }) => {
      const blocked=blockForeignSite(request); if(blocked)return blocked;
      let body:Record<string,unknown>={};
      try{body=await request.json() as Record<string,unknown>;}catch{return Response.json({ok:false,error:"Petición no válida."},{status:400});}
      const action=String(body.action??"");
      try{
        if(action==="boe-search")return Response.json({ok:true,results:await searchBoeLegislation(String(body.query??""),Number(body.limit??8)),links:officialLegalLinks(String(body.query??""))},{headers:{"Cache-Control":"no-store"}});
        if(action==="boe-text")return Response.json({ok:true,result:await getBoeLegislationText(String(body.id??""))},{headers:{"Cache-Control":"no-store"}});
        if(action==="boja-search")return Response.json({ok:true,results:await searchBoja(String(body.query??""),Number(body.limit??10))},{headers:{"Cache-Control":"no-store"}});
        if(action==="boja-text")return Response.json({ok:true,result:await getBojaDisposition(String(body.id??""))},{headers:{"Cache-Control":"no-store"}});
        if(action==="eu-law-search")return Response.json({ok:true,results:await searchEuLegislation(String(body.query??""),Number(body.limit??10))},{headers:{"Cache-Control":"no-store"}});
        if(action==="eu-case-search")return Response.json({ok:true,results:await searchEuCaseLaw(String(body.query??""),Number(body.limit??10))},{headers:{"Cache-Control":"no-store"}});
        if(action==="eu-celex-text")return Response.json({ok:true,result:await getEuDocumentByCelex(String(body.celex??""))},{headers:{"Cache-Control":"no-store"}});
        if(action==="boe-summary")return Response.json({ok:true,result:await getBoeDailySummary(String(body.date??""),false)},{headers:{"Cache-Control":"no-store"}});
        if(action==="borme-summary")return Response.json({ok:true,result:await getBoeDailySummary(String(body.date??""),true)},{headers:{"Cache-Control":"no-store"}});
        if(action==="boe-aux")return Response.json({ok:true,result:await getBoeAuxTable(String(body.name??""))},{headers:{"Cache-Control":"no-store"}});
        if(action==="official-links")return Response.json({ok:true,links:officialLegalLinks(String(body.query??""))},{headers:{"Cache-Control":"no-store"}});
        if(action==="cases-load")return Response.json({ok:true,cases:await loadLegalCases()},{headers:{"Cache-Control":"no-store"}});
        if(action==="cases-save")return Response.json({ok:true,saved:await saveLegalCases(body.cases)},{headers:{"Cache-Control":"no-store"}});
        return Response.json({ok:false,error:"Acción jurídica desconocida."},{status:400});
      }catch(error){return Response.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:502});}
    },
  }},
});
