// Interacciones fármaco-nutriente documentadas en literatura clínica.
// Formato: [nombre, principioActivo, grupo, [ {nutriente, alimentos, tipo, severidad, recomendacion} ]]
// Solo interacciones establecidas. Información orientativa (no sustituye criterio médico/farmacéutico).
export const FARMACOS = [
  ["Sintrom","Acenocumarol","Anticoagulante",[
    {nutriente:"Vitamina K",alimentos:["Espinacas","Acelgas","Brócoli","Col rizada (kale)","Coles de Bruselas","Lechuga","Perejil","Té verde"],tipo:"antagonismo",severidad:"alta",recomendacion:"Mantén una ingesta CONSTANTE de verduras de hoja verde; no las elimines ni las aumentes bruscamente, ya que alteran el INR."},
    {nutriente:"Alcohol",alimentos:["Vino tinto","Cerveza"],tipo:"potenciación",severidad:"media",recomendacion:"Evita el consumo excesivo o irregular de alcohol: puede aumentar el efecto anticoagulante."}]],
  ["Aldocumar","Warfarina","Anticoagulante",[
    {nutriente:"Vitamina K",alimentos:["Espinacas","Acelgas","Brócoli","Col rizada (kale)","Coles de Bruselas"],tipo:"antagonismo",severidad:"alta",recomendacion:"Ingesta constante de verdura de hoja verde. Evita cambios bruscos que descontrolen el INR."}]],
  ["Eutirox","Levotiroxina","Hormona tiroidea",[
    {nutriente:"Calcio",alimentos:["Leche entera","Yogur natural","Queso curado","Queso fresco de Burgos"],tipo:"reduce absorción",severidad:"media",recomendacion:"Toma la levotiroxina en ayunas y separa al menos 4 horas de lácteos y suplementos de calcio."},
    {nutriente:"Café",alimentos:["Café solo"],tipo:"reduce absorción",severidad:"media",recomendacion:"Espera 30-60 minutos tras tomar la pastilla antes de tomar café."},
    {nutriente:"Fibra/Soja",alimentos:["Bebida de soja","Tofu","Salvado"],tipo:"reduce absorción",severidad:"baja",recomendacion:"Separa la soja y la fibra alta de la toma del fármaco."}]],
  ["Levotiroxina","Levotiroxina","Hormona tiroidea",[
    {nutriente:"Calcio/Hierro",alimentos:["Leche entera","Yogur natural","Lentejas","Espinacas"],tipo:"reduce absorción",severidad:"media",recomendacion:"En ayunas y separada 4 h de calcio, hierro y suplementos."}]],
  ["Dianben","Metformina","Antidiabético",[
    {nutriente:"Vitamina B12",alimentos:[],tipo:"reduce absorción",severidad:"media",recomendacion:"El uso prolongado puede bajar la B12; conviene controlar niveles periódicamente e incluir alimentos ricos en B12."},
    {nutriente:"Alcohol",alimentos:["Vino tinto","Cerveza"],tipo:"potenciación",severidad:"alta",recomendacion:"Evita el alcohol: aumenta el riesgo de acidosis láctica e hipoglucemia."}]],
  ["Atorvastatina","Atorvastatina","Estatina",[
    {nutriente:"Pomelo",alimentos:["Pomelo","Zumo de pomelo"],tipo:"aumenta niveles del fármaco",severidad:"alta",recomendacion:"Evita el pomelo y su zumo: elevan el fármaco en sangre y el riesgo de efectos musculares."}]],
  ["Simvastatina","Simvastatina","Estatina",[
    {nutriente:"Pomelo",alimentos:["Pomelo","Zumo de pomelo"],tipo:"aumenta niveles del fármaco",severidad:"alta",recomendacion:"Evita completamente el pomelo: es la estatina más sensible a esta interacción."}]],
  ["Adiro","Ácido acetilsalicílico","Antiagregante",[
    {nutriente:"Alcohol",alimentos:["Vino tinto","Cerveza"],tipo:"potenciación",severidad:"media",recomendacion:"Modera el alcohol: aumenta el riesgo de irritación y sangrado gástrico."}]],
  ["Omeprazol","Omeprazol","Protector gástrico (IBP)",[
    {nutriente:"Vitamina B12",alimentos:[],tipo:"reduce absorción",severidad:"baja",recomendacion:"El uso prolongado puede reducir la absorción de B12, hierro y magnesio; vigila niveles si es crónico."}]],
  ["Fosamax","Alendronato","Bifosfonato",[
    {nutriente:"Calcio",alimentos:["Leche entera","Yogur natural","Queso curado"],tipo:"reduce absorción",severidad:"alta",recomendacion:"Toma en ayunas con agua y espera al menos 30-60 min antes de lácteos, café o zumos."}]],
  ["Enalapril","Enalapril","IECA (tensión)",[
    {nutriente:"Potasio",alimentos:["Plátano","Aguacate","Espinacas","Orejones de albaricoque"],tipo:"acumulación",severidad:"media",recomendacion:"Evita el exceso de potasio y los sustitutos de sal con potasio: pueden provocar hiperpotasemia."}]],
  ["Ramipril","Ramipril","IECA (tensión)",[
    {nutriente:"Potasio",alimentos:["Plátano","Aguacate","Espinacas","Dátiles"],tipo:"acumulación",severidad:"media",recomendacion:"Cuidado con sales de potasio y suplementos: riesgo de hiperpotasemia."}]],
  ["Nolotil","Metamizol","Analgésico",[]],
  ["Furosemida","Furosemida","Diurético",[
    {nutriente:"Potasio",alimentos:["Plátano","Aguacate","Naranja","Espinacas"],tipo:"pérdida",severidad:"media",recomendacion:"Este diurético hace perder potasio; conviene incluir alimentos ricos en potasio salvo indicación contraria."}]],
  ["Nardil","Fenelzina","Antidepresivo IMAO",[
    {nutriente:"Tiramina",alimentos:["Queso curado","Queso azul","Queso parmesano","Embutidos","Chorizo","Salchichón","Vino tinto","Cerveza","Salsa de soja"],tipo:"crisis hipertensiva",severidad:"alta",recomendacion:"Evita ESTRICTAMENTE alimentos ricos en tiramina (quesos curados, embutidos, fermentados): riesgo de crisis hipertensiva grave."}]],
  ["Ciprofloxacino","Ciprofloxacino","Antibiótico (quinolona)",[
    {nutriente:"Calcio/Hierro",alimentos:["Leche entera","Yogur natural","Queso curado","Lentejas"],tipo:"reduce absorción",severidad:"media",recomendacion:"Separa 2 h de lácteos, calcio y hierro: forman complejos que impiden la absorción del antibiótico."}]],
  ["Doxiciclina","Doxiciclina","Antibiótico (tetraciclina)",[
    {nutriente:"Calcio/Hierro",alimentos:["Leche entera","Yogur natural","Queso curado"],tipo:"reduce absorción",severidad:"media",recomendacion:"No tomar con lácteos ni suplementos de calcio/hierro; separa al menos 2 horas."}]],
  ["Sertralina","Sertralina","Antidepresivo ISRS",[
    {nutriente:"Alcohol",alimentos:["Vino tinto","Cerveza"],tipo:"potenciación",severidad:"media",recomendacion:"Evita el alcohol: potencia somnolencia y efectos sobre el sistema nervioso."}]],
  ["Digoxina","Digoxina","Cardiotónico",[
    {nutriente:"Fibra",alimentos:["Salvado","Copos de avena","Pan integral"],tipo:"reduce absorción",severidad:"baja",recomendacion:"Separa la toma de comidas muy ricas en fibra; mantén ingesta estable de potasio."},
    {nutriente:"Regaliz",alimentos:["Regaliz"],tipo:"toxicidad",severidad:"alta",recomendacion:"Evita el regaliz: puede bajar el potasio y aumentar la toxicidad de la digoxina."}]],
  ["Warfarina","Warfarina","Anticoagulante",[
    {nutriente:"Vitamina K",alimentos:["Espinacas","Brócoli","Coles de Bruselas","Col rizada (kale)"],tipo:"antagonismo",severidad:"alta",recomendacion:"Ingesta constante de verdura verde; evita cambios bruscos que alteren el INR."}]],
  ["Losartán","Losartán","ARA-II (tensión)",[
    {nutriente:"Potasio",alimentos:["Plátano","Aguacate","Espinacas","Dátiles"],tipo:"acumulación",severidad:"media",recomendacion:"Evita sustitutos de sal con potasio y el exceso de alimentos muy ricos en potasio."}]],
  ["Espironolactona","Espironolactona","Diurético ahorrador de potasio",[
    {nutriente:"Potasio",alimentos:["Plátano","Aguacate","Orejones de albaricoque","Espinacas"],tipo:"acumulación",severidad:"alta",recomendacion:"Retiene potasio: evita suplementos y sustitutos de sal con potasio (riesgo de hiperpotasemia)."}]],
  ["Alopurinol","Alopurinol","Antigotoso",[
    {nutriente:"Purinas/Alcohol",alimentos:["Hígado de ternera","Sardina","Anchoas en salazón","Cerveza"],tipo:"empeora control",severidad:"media",recomendacion:"Limita vísceras, pescado azul pequeño y alcohol (sobre todo cerveza): elevan el ácido úrico."}]],
  ["Colchicina","Colchicina","Antigotoso",[
    {nutriente:"Pomelo",alimentos:["Pomelo","Zumo de pomelo"],tipo:"aumenta niveles del fármaco",severidad:"alta",recomendacion:"Evita el pomelo: aumenta la concentración del fármaco y su toxicidad."}]],
  ["Amoxicilina","Amoxicilina","Antibiótico (penicilina)",[]],
  ["Ibuprofeno","Ibuprofeno","Antiinflamatorio (AINE)",[
    {nutriente:"Alcohol",alimentos:["Vino tinto","Cerveza"],tipo:"potenciación",severidad:"media",recomendacion:"Evita el alcohol y toma con алimento: reduce el riesgo de irritación y sangrado gástrico."}]],
  ["Paracetamol","Paracetamol","Analgésico",[
    {nutriente:"Alcohol",alimentos:["Vino tinto","Cerveza"],tipo:"toxicidad hepática",severidad:"media",recomendacion:"Evita el alcohol de forma habitual: aumenta el riesgo de daño hepático."}]],
  ["Hierro oral","Sulfato ferroso","Suplemento de hierro",[
    {nutriente:"Calcio/Café/Té",alimentos:["Leche entera","Café solo","Té","Queso curado"],tipo:"reduce absorción",severidad:"media",recomendacion:"Toma el hierro separado de lácteos, café y té. La vitamina C (naranja) mejora su absorción."}]],
  ["Bilaxten","Bilastina","Antihistamínico",[
    {nutriente:"Zumo de frutas",alimentos:["Zumo de naranja natural","Zumo de piña envasado","Pomelo"],tipo:"reduce absorción",severidad:"baja",recomendacion:"Toma con agua, no con zumos de fruta: reducen su absorción. En ayunas."}]],
];
