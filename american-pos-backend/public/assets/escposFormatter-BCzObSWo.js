import{m as Ee,h as me,G as oe,j as Oe,X as de,y as G,f as Ce,A as re,e as Te}from"./index-DPBt-Ru9.js";import"./vendor-motion-BmNYwpEx.js";import"./vendor-react-CzpYscRE.js";import"./vendor-docs-CwlUR6Og.js";import"./vendor-utils-oi7SpmsG.js";import"./vendor-icons-8S1rauL-.js";const V="\x1B",Ae="",F="",j=V+"@"+Ae+"."+V+"t\0",k=V+"a\0",h=V+"a",Le=V+"a",A=V+"E",g=V+"E\0",$=F+"!",b=F+"!\0",z=F+"V";function s(e){return e?String(e).replace(/[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g," ").replace(/¡/g,"").replace(/¿/g,"").replace(/[º°]/g,".").replace(/ª/g,"a").replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[—–]/g,"-").replace(/•/g,"*").replace(/€/g,"E").replace(/ñ/g,"n").replace(/Ñ/g,"N").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[\u0080-\uFFFF]/g,""):""}function p(e,r,E){const c=s(e),f=s(r),d=E-c.length-f.length;if(d>0)return c+" ".repeat(d)+f;if(c.length+f.length>E){const t=E-f.length-1;return c.substring(0,t)+" "+f}return c+f}function q(e,r){const E=s(e);if(E.length>=r)return E.substring(0,r);const c=Math.floor((r-E.length)/2);return" ".repeat(c)+E}function W(e,r,E="center"){return e?String(e).split(`
`).map(c=>{const f=c.trim();return f?E==="center"?q(f,r):E==="right"?f.substring(0,r).padStart(r," "):f.substring(0,r):""}).filter(Boolean).join(`
`):""}function Pe(e,r={},E=1,c="BOTH",f=[],d={}){var Y;const a=r.receiptWidth==="80mm"?48:32,R=r.country||localStorage.getItem("pos_country")||"",S=Ee(R),u=!!r.isUsdOnly||S||me({currencyMode:c,country:R,...r}),N=u?1:E,m=u?"USD":c,T=!u&&!!(r.receiptOnlyBs||c==="VES"),I=oe(e.createdAt||Date.now(),{dateStyle:"short"}),_=new Date(e.createdAt||Date.now()).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),y=e.documentType==="nota_entrega"?"NOTA DE ENTREGA":"FACTURA",l=(e==null?void 0:e.dailyTicketNumber)||((Y=e==null?void 0:e.taxInfo)==null?void 0:Y.dailyTicketNumber)||null,H=String((e==null?void 0:e.id)||"").split("-")[0].toUpperCase(),ae={rate:N,currencyMode:m},D=(U,n=null)=>Te(U,u?"USD":n,ae),J=(U="STANDARD")=>{var ee,te,ne;let n="";n+=j,n+=h+A,r.name?n+=$+s(r.name).toUpperCase()+`
`+b:n+=$+`ISAAC POS
`+b,n+=g;const ce=Oe(R),se=de(R);if(r.rif&&(n+=`${ce}: ${s(r.rif).toUpperCase()}
`),r.address&&(n+=W(r.address,a,"center")+`
`),r.phone&&(n+=`TEL: ${s(r.phone)}
`),r.receiptHeader){let o=String(r.receiptHeader).replace(/\{\{nombre_empresa\}\}/gi,r.name||"Isaac POS").replace(/\{\{rif\}\}/gi,r.rif||"").replace(/\{\{ruc\}\}/gi,r.rif||"").replace(/\{\{nit\}\}/gi,r.rif||"").replace(/\{\{direccion\}\}/gi,r.address||"").replace(/\{\{telefono\}\}/gi,r.phone||"").replace(/\{\{cliente_nombre\}\}/gi,e.customerName||"Cliente Ocasional").replace(/\{\{documento_cliente\}\}/gi,e.customerDoc||"").replace(/\{\{fecha\}\}/gi,I).replace(/\{\{hora\}\}/gi,_).replace(/\{\{nro_recibo\}\}/gi,H);n+=W(o,a,"center")+`
`}n+=k,n+="-".repeat(a)+`
`,e.isReprint||e.reprintCount>0?(n+=h+A,n+=$+`*** COPIA / REIMPRESION ***
`+b,n+=q("NO VALIDO COMO COMPROBANTE ORIGINAL",a)+`
`,n+=g+k,n+="-".repeat(a)+`
`):U==="CONTROL"?(n+=h+A,n+=$+`*** COPIA / CONTROL ***
`+b,n+=q("USO INTERNO DEL COMERCIO",a)+`
`,n+=g+k,n+="-".repeat(a)+`
`):U==="ORIGINAL"&&(n+=h+A,n+=q("*** ORIGINAL - CLIENTE ***",a)+`
`,n+=g+k,n+="-".repeat(a)+`
`),n+=A,l&&(n+=p("NUMERO DE TICKET:",`#${l}`,a)+`
`),n+=p("DOCUMENTO:",y,a)+`
`,n+=p("RECIBO:",l?`#${l} (${H})`:`#${H}`,a)+`
`,n+=g,n+=p("FECHA/HORA:",`${I} ${_}`,a)+`
`;const K=e.cashierName||e.userName||((ee=e.User)==null?void 0:ee.name)||r.cashierName;K&&(n+=p("CAJERO:",s(K).toUpperCase(),a)+`
`),!u&&c==="BOTH"&&!T&&(n+=p("TASA DE CAMBIO:",`${G(N).replace("Bs.S ","").replace("Bs. ","").replace("Bs.","").trim()} BS/$`,a)+`
`),n+=p("CLIENTE:",(e.customerName||"CLIENTE OCASIONAL").toUpperCase(),a)+`
`,e.customerDoc&&(n+=p(`${se}:`,s(e.customerDoc).toUpperCase(),a)+`
`),n+="-".repeat(a)+`
`;const X=Array.isArray(e.SaleItems)?e.SaleItems:Array.isArray(e.items)?e.items:[],fe=X.reduce((o,C)=>o+(Number(C.quantity)||0),0);X.forEach(o=>{let C=s(o.name).toUpperCase();o.isBulk?C=`[${s(o.bulkUnitName||"PAQ").toUpperCase()}${o.unitsPerBulk?" x"+o.unitsPerBulk:""}] ${C}`:o.isMidBulk&&(C=`[${s(o.midBulkUnitName||"MEDIA").toUpperCase()}${o.unitsPerMidBulk?" x"+o.unitsPerMidBulk:""}] ${C}`);const i=D(o.price),B=D(o.subtotal||o.price*o.quantity),w=p(C,B,a);n+=A+w+g+`
`;const L=o.isBulk?` ${s(o.bulkUnitName||"Paq")}`:o.isMidBulk?` ${s(o.midBulkUnitName||"Med")}`:"",P=s(`  ${Ce(o.quantity)}${L} x ${i}`);if(n+=P.substring(0,a)+`
`,o.batchNumber||o.expirationDate){let O="  ";o.batchNumber&&(O+=`Lote: ${s(o.batchNumber)} `),o.expirationDate&&(O+=`Venc: ${s(o.expirationDate)}`),n+=O.substring(0,a)+`
`}if(o.appliedPromoName||o.promoDiscount>0){const O=`  * PROMO: ${s(o.appliedPromoName||"OFERTA")}`,M=o.promoDiscount?` (-${s(D(o.promoDiscount))})`:"";n+=s(O+M).substring(0,a)+`
`}}),n+="-".repeat(a)+`
`,n+=p("TOTAL ITEMS:",`${X.length} (${fe} unids)`,a)+`
`,n+=p("SUB-TOTAL:",D(e.subtotal),a)+`
`,(e.totalPromoSavings>0||e.promoSavings>0)&&(n+=A+p("AHORRO PROMO:",`-${D(e.totalPromoSavings||e.promoSavings)}`,a)+g+`
`),((te=e.taxInfo)==null?void 0:te.exemptBase)>0&&(n+=p("EXENTO:",D(e.taxInfo.exemptBase),a)+`
`),((ne=e.taxInfo)==null?void 0:ne.taxableBase)>0&&(n+=p(`IVA (${e.taxRate||16}%):`,D(e.tax),a)+`
`),e.igtfAmount>0&&(n+=p("IGTF (3%):",D(e.igtfAmount),a)+`
`),(e.discountAmount>0||e.discount>0)&&(n+=p("DESCUENTO:",`-${D(e.discountAmount||e.discount)}`,a)+`
`),n+=A;const le="TOTAL:",pe=D(e.total,u?"USD":c==="BOTH"?"VES":null);n+=p(le,pe,a)+`
`,n+=g,!u&&c==="BOTH"&&!T&&(n+=p("REF. USD ($):",D(e.total,"USD"),a)+`
`),n+="-".repeat(a)+`
`;const Z=(o,C)=>{if(!o)return C==="VES"||C==="BS"?"EFECTIVO BS":"EFECTIVO";const i=String(o).toLowerCase().trim(),B=String(C||"").toUpperCase().trim(),w=B==="VES"||B==="BS";if(u){if(i.includes("cash")||i.includes("efectivo"))return"EFECTIVO";if(i==="biopago")return"PAGO DIGITAL";if(i==="debit"||i==="debito"||i==="punto_de_venta"||i.includes("punto")||i==="card"||i==="tarjeta")return"TARJETA / DEBITO";if(i==="pago_movil"||i.includes("movil")||i==="transfer"||i==="transferencia"||i==="transfer_bs")return"TRANSFERENCIA";if(i==="zelle")return"ZELLE";if(i==="credit"||i==="credito"||i==="fiado")return"CREDITO"}if(i==="binance_usdt"||i==="binance"||i.includes("binance")||i==="usdt"){const O=Array.isArray(f)&&f.find(M=>M.id===o||String(M.id).toLowerCase()===i||M.name&&M.name.toLowerCase().includes("binance"));return String((O==null?void 0:O.receiptLabel)||"PAGO ELECTRONICO").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toUpperCase()}const L=Array.isArray(f)&&f.find(O=>O.id===o||String(O.id).toLowerCase()===i);if(L&&L.name){let O=L.name.toUpperCase();return L.id==="binance_usdt"||O.includes("BINANCE")||O.includes("USDT")?String(L.receiptLabel||"PAGO ELECTRONICO").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toUpperCase():u&&(O.includes("EFECTIVO BS")||O.includes("EFECTIVO $")||O.includes("EFECTIVO USD"))?"EFECTIVO":O}const P={cash:u?"EFECTIVO":w?"EFECTIVO BS":"EFECTIVO $",efectivo_usd:u?"EFECTIVO":"EFECTIVO $",cash_usd:u?"EFECTIVO":"EFECTIVO $",cash_bs:u?"EFECTIVO":"EFECTIVO BS",efectivo_bs:u?"EFECTIVO":"EFECTIVO BS",cash_ves:u?"EFECTIVO":"EFECTIVO BS",pago_movil:u?"TRANSFERENCIA":"PAGO MOVIL",biopago:u?"PAGO DIGITAL":"BIOPAGO (BDV)",zelle:"ZELLE",debit:u?"TARJETA / DEBITO":"PUNTO VENTA",debito:u?"TARJETA / DEBITO":"PUNTO VENTA",credit:"CREDITO",credito:"CREDITO",fiado:"CREDITO",transfer:"TRANSFERENCIA",transferencia:"TRANSFERENCIA"};return P[i]?P[i]:String(o).replace(/_/g," ").toUpperCase()},x=(()=>{let o=e.paymentMethods||e.PaymentDetails||e.splitDetails;if(typeof o=="string")try{o=JSON.parse(o)}catch{o=[]}return Array.isArray(o)?o:[]})(),Q=(()=>{var C;const o=String(e.paymentReference||e.reference||((C=e.taxInfo)==null?void 0:C.reference)||"").trim();return o||(typeof e.notes=="string"&&e.notes.toLowerCase().startsWith("ref:")?e.notes.substring(4).trim():"")})(),ue=(()=>{if(x.length>0)return x.map(i=>{const B=i.method==="binance_usdt"||String(i.method).toLowerCase().includes("binance")||(i.currency||"").toUpperCase()==="USDT",w=Z(i.method,i.currency),L=!u&&(B||i.currency==="VES"||i.currency==="BS"||i.method==="cash_bs"||i.method==="efectivo_bs");let P=i.amount;B&&!u&&(P=i.convertedAmountBs||(i.amount&&i.cryptoRate?Number(i.amount)*Number(i.cryptoRate):e.totalBs||e.total*E));const O=L?G(P):re(P);return`${w}: ${O}`}).join(" | ");const o=e.paymentMethod||"cash",C=e.currency||(o==="cash_bs"?"VES":"USD");return Z(o,C)})();if(n+=p("PAGO:",ue,a)+`
`,x.length>0?x.forEach((o,C)=>{const i=String(o.reference||o.ref||o.paymentReference||(x.length===1&&C===0?Q:"")||"").trim();if(i){const B=x.length>1?`REF. ${Z(o.method,o.currency)}:`:"REF. OPERACION:";n+=p(B,`#${s(i)}`,a)+`
`}}):Q&&(n+=p("REF. OPERACION:",`#${s(Q)}`,a)+`
`),e.change>0||e.changeUsd>0||e.changeBs>0){const o=!u&&e.changeBs>0?G(e.changeBs):re(e.changeUsd||e.change||e.changeBs);n+=p("CAMBIO/VUELTO:",o,a)+`
`}if(n+="-".repeat(a)+`
`,n+=h,r.receiptFooter){let o=String(r.receiptFooter).replace(/\{\{nombre_empresa\}\}/gi,r.name||"Isaac POS").replace(/\{\{rif\}\}/gi,r.rif||"").replace(/\{\{direccion\}\}/gi,r.address||"").replace(/\{\{telefono\}\}/gi,r.phone||"").replace(/\{\{cliente_nombre\}\}/gi,e.customerName||"Cliente Ocasional").replace(/\{\{documento_cliente\}\}/gi,e.customerDoc||"").replace(/\{\{fecha\}\}/gi,I).replace(/\{\{hora\}\}/gi,_).replace(/\{\{nro_recibo\}\}/gi,H);n+=W(o,a,"center")+`
`}else n+=`GRACIAS POR SU COMPRA!
`;return n+=W("Isaac POS",a,"center")+`
`,n+=`




`+z,n},ie=Number(d.copies||r.receiptCopies)||1;let v="";if(ie===2?(v+=J("ORIGINAL"),v+=J("CONTROL")):v+=J("STANDARD"),r.enableWarehouseDispatchSlip||d.includeWarehouseDispatch){const U=ge(e,r);U&&(v+=U)}return v}function ge(e,r={}){var N;if(!e)return"";const c=r.receiptWidth==="80mm"?48:32,d=(e.items||e.SaleItems||[]).filter(m=>{const T=Number(m.factorConversion||m.unitsMultiplier||m.unitsPerBulk||1),I=String(m.presentationName||m.packName||"").trim(),_=String(m.name||m.nombre||"").trim();return/caja|bulto|saco|fardo|paca|paleta|canasta/i.test(I)||/caja|bulto|saco|fardo|paca|paleta|canasta/i.test(_)||T>=100||!!m.isBulk||!!m.dispatchFromWarehouse});if(d.length===0)return"";let t="";t+=j,t+=h,t+=$,t+=s("VALE DE DESPACHO")+`
`,t+=s("RETIRO EN DEPOSITO")+`
`,t+=b,t+=A,t+=s(r.name||"DEPOSITO PRINCIPAL")+`
`,t+=g;const a=e.date||e.timestamp||e.createdAt||new Date,R=oe(a),S=(e==null?void 0:e.dailyTicketNumber)||((N=e==null?void 0:e.taxInfo)==null?void 0:N.dailyTicketNumber)||null,u=e.invoiceNumber||String(e.id).slice(-8);t+="-".repeat(c)+`
`,S&&(t+=A+`NUMERO DE TICKET: #${S}
`+g),t+=p(`Numero de Ticket: ${S?`#${S} (${u})`:u}`,R,c)+`
`,t+=p(`Cliente: ${s(e.customerName||"Cliente Ocasional")}`,`Caja: ${s(e.cashierName||"1")}`,c)+`
`,t+="-".repeat(c)+`
`,t+=k,t+=A,t+=s("MERCANCIA A RETIRAR / DESPACHAR:")+`
`,t+="-".repeat(c)+`
`;for(const m of d){const T=Number(m.factorConversion||m.unitsMultiplier||m.unitsPerBulk||1),I=Number(m.quantity)||1,_=s(m.name||m.nombre||"Producto"),y=s(m.presentationName||(m.isBulk?"BULTO CERRADO":"EMPAQUE"));t+=`${I}x [${y}] ${_}
`,T>1&&(t+=`   --> Entregar: ${I*T} Unidades base
`)}return t+=g,t+="-".repeat(c)+`
`,t+=h,t+=`

`,t+=s("Firma Almacenero: ___________________")+`
`,t+=s("Firma Cliente:    ___________________")+`



`,t+=z,t}function Se(e,r=!1){if(!e)return"";const E=s(String(e).trim());if(!E)return"";const c=r?42:55,f=r&&E.length>9?1:2,d="{B"+E,t=d.length;let a="";return a+=h,a+=F+"h"+String.fromCharCode(c),a+=F+"w"+String.fromCharCode(f),a+=F+"H",a+=F+"f",a+=F+"kI"+String.fromCharCode(t)+d+`
`,a}function Ne(e,r={},E=1,c=!1){if(!e)return"";const f=c?32:48,d="-".repeat(f);let t="";if(t+=h,r.showName!==!1&&e.name){t+=A;const N=s(e.name).toUpperCase();if(N.length<=f)t+=N+`
`;else{const m=N.split(" ");let T="";for(const I of m)(T+" "+I).trim().length<=f?T=(T+" "+I).trim():(T&&(t+=T+`
`),T=I);T&&(t+=T+`
`)}t+=g}const a=Number(e.price)||0,R=(a*(E||1)).toFixed(2),S=r.showPrice!==!1,u=r.showPriceBs!==!1;if((S||u)&&(t+=A,S&&u?(t+=$,t+=`$${a.toFixed(2)}
`,t+=b,t+=`Ref: ${R} Bs
`):S?(t+=$,t+=`$${a.toFixed(2)}
`,t+=b):(t+=$,t+=`${R} Bs
`,t+=b),t+=g),r.showBarcode!==!1&&e.barcode)try{t+=Se(e.barcode,c)}catch(N){console.warn("Error formateando código de barras ESC/POS:",N),t+=s(`* ${e.barcode} *`)+`
`}return t+=h,t+=d+`
`,c?t+=`


`:t+=`

`,t}function Fe(e=[],r={},E=1,c=!1){if(!Array.isArray(e)||e.length===0)return"";let f="";f+=j;for(const d of e){const t=Number(d.labelCopies)||1;for(let a=0;a<t;a++)f+=Ne(d,r,E,c)}return c?f+=`

`:f+=`

`+z,f}function $e(e={},r={}){const E=r.receiptWidth==="58mm"||r.printerName&&r.printerName.includes("58"),c=E?32:48,f="=".repeat(c),d="-".repeat(c),t=String(e.phoneNumber||e.telefono||"").replace(/\D/g,""),a=t.length===11?`${t.slice(0,4)}-${t.slice(4)}`:t,R={pago_movil:"PAGO MOVIL",PAGO_MOVIL:"PAGO MOVIL",cash_bs:"EFECTIVO (BS)",EFECTIVO_BS:"EFECTIVO (BS)",debit:"PUNTO DE VENTA",PUNTO_VENTA:"PUNTO DE VENTA",cash:"EFECTIVO ($ / DIVISAS)",DIVISAS:"EFECTIVO ($ / DIVISAS)",zelle:"ZELLE",biopago:"BIOPAGO BDV"},S=e.paymentMethod||e.metodoPago||"pago_movil",u=R[S]||R[String(S).toLowerCase()]||s(String(S).toUpperCase()),N=Number(e.nominalAmountBs??e.montoNominal??0),m=Number(e.serviceFeeBs??e.comision??0),T=Number(e.totalChargedBs??e.totalCobrado??N+m),I=s(String(e.providerRef||e.referenciaMovilway||"MW-OK")),_=s(String(e.customerPaymentRef||e.refCliente||"").trim()),y=e.fecha||new Date(e.createdAt||Date.now()).toLocaleString("es-VE",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:!0});let l="";return l+=j,l+=h,r.name&&(l+=A+s(r.name.toUpperCase())+`
`+g),r.rif&&(l+=s(`RIF: ${r.rif}`)+`
`),l+=f+`
`,l+=A+`COMPROBANTE DE RECARGA
`+g,l+=f+`
`,l+=k,l+=p("FECHA:",s(y),c)+`
`,l+=p("OPERADORA:",s(String(e.operator||e.operadora||"MOVISTAR").toUpperCase()),c)+`
`,l+=A+p("TELEFONO:",s(a),c)+`
`+g,l+=p("REF OPERADOR:",`#${I}`,c)+`
`,l+=d+`
`,l+=p("MONTO RECARGADO:",G(N),c)+`
`,m>0&&(l+=p("SERVICIO CAJA:",G(m),c)+`
`),l+=A+p("TOTAL PAGADO:",G(T),c)+`
`+g,l+=p("METODO:",u,c)+`
`,_&&(l+=p("REF PAGO CLIENTE:",`#${_}`,c)+`
`),l+=d+`
`,l+=h,l+=`Verifique su saldo marcando
`,l+=`el codigo de su operadora.
`,l+=`No se aceptan devoluciones
`,l+=`en recargas a numeros errados
`,l+=f+`
`,E?l+=`



`:l+=`



`+z,l}export{h as ESC_ALIGN_CENTER,k as ESC_ALIGN_LEFT,Le as ESC_ALIGN_RIGHT,g as ESC_BOLD_OFF,A as ESC_BOLD_ON,j as ESC_INIT,z as GS_CUT,$ as GS_TEXT_DOUBLE,b as GS_TEXT_NORMAL,s as cleanAscii,Se as formatBarcodeEscPos,Fe as formatBatchProductLabelsToEscPos,q as formatCenter,p as formatLine,W as formatParagraph,Ne as formatProductLabelToEscPos,$e as formatRechargeToEscPos,Pe as formatSaleToEscPos,ge as formatWarehouseDispatchSlip};
