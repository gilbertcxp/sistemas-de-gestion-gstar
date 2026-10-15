/* ============================================================
   Calculo — reproduce, celda por celda, las fórmulas de la plantilla
   oficial "FORMATO DE FACTURA JV.xlsx" (hoja Hoja1).

   Entradas MANUALES de la plantilla (las únicas que no son fórmula):
     C13  Venta Bruta             ← ORKAPI "Ventas Netas"
     C14  (-) Pago de Premios     ← ORKAPI "Pagos" (en valor absoluto)

   Fórmulas de la plantilla (referencia → aquí):
     E15  =C13-C14                  resultadoPremios
     E23  =C13*0.01                 jackpot        (1% Vta Bruta · GSTAR)
     C24  =C13*0.5%                 comision       (0.5% Vta Bruta · OPERADOR)
     E25  =C13*0.01                 hipodromo      (1% Vta Bruta · GSTAR)
     C26  =SUM(C23:C25)             totalOperador  (C23 y C25 están vacías)
     E26  =SUM(E23:E25)             totalGstar     (E24 está vacía)
     E16  =-C26-E26                 deducciones
     E17  =E15+E16                  resultado
     C20  =E17*0.7                  distOperador
     E20  =E17*0.3                  distGstar
     C29  =C20+C26                  totalPagarOperador
     E29  =E20+E26                  totalPagarGstar
     E10  =E26                      montoNetoRapid

   No se redondea (igual que Excel: solo se MUESTRA con 2 decimales).
   NOTA: el formato vigente de la factura ya NO muestra la fila "MONTO NETO A PAGAR RAPID"
   (E10); el valor se sigue calculando (montoNetoRapid) pero no se escribe en el Excel.

   Los porcentajes se guardan dentro de cada factura (snapshot) para que
   una factura vieja siempre se pueda reproducir tal como se emitió.
   ============================================================ */
const Calculo = (() => {

  const PARAMS_DEFAULT = Object.freeze({
    jackpot:   0.01,    // B23
    comision:  0.005,   // B24
    hipodromo: 0.01,    // B25
    operador:  0.7,     // B20
    gstar:     0.3      // D20
  });

  function calcular(ventaBruta, premios, params){
    const p = { ...PARAMS_DEFAULT, ...(params || {}) };
    const C13 = Number(ventaBruta) || 0;
    const C14 = Number(premios) || 0;

    const E15 = C13 - C14;                 // (=) Resultado después de premios
    const E23 = C13 * p.jackpot;           // (-) Jackpot Acumulado · GSTAR
    const C24 = C13 * p.comision;          // (-) Comisión Agentes de ventas · OPERADOR
    const E25 = C13 * p.hipodromo;         // (-) Hipódromo · GSTAR
    const C26 = C24;                       // (=) TOTAL operador  = SUM(C23:C25)
    const E26 = E23 + E25;                 // (=) TOTAL GSTAR     = SUM(E23:E25)
    const E16 = -C26 - E26;                // Deducciones (negativo)
    const E17 = E15 + E16;                 // Resultado
    const C20 = E17 * p.operador;          // Distribución OPERADOR (70%)
    const E20 = E17 * p.gstar;             // Distribución GSTAR (30%)
    const C29 = C20 + C26;                 // TOTAL A PAGAR OPERADOR
    const E29 = E20 + E26;                 // TOTAL A PAGAR GSTAR
    const E10 = E26;                       // MONTO NETO A PAGAR RAPID (= E26 en la plantilla)

    return {
      ventaBruta: C13, premios: C14,
      pctPremios: C13 ? (C14 / C13) : 0,   // la plantilla trae "(87.2%)" fijo como texto; aquí se calcula real
      resultadoPremios: E15,
      jackpot: E23, comision: C24, hipodromo: E25,
      totalOperador: C26, totalGstar: E26,
      deducciones: E16, resultado: E17,
      distOperador: C20, distGstar: E20,
      totalPagarOperador: C29, totalPagarGstar: E29,
      montoNetoRapid: E10
    };
  }

  // Mapa celda-de-plantilla → valor, para escribir en el Excel exportado
  function aCeldas(c){
    return {
      C13: c.ventaBruta, C14: c.premios,
      E15: c.resultadoPremios, E16: c.deducciones, E17: c.resultado,
      C20: c.distOperador, E20: c.distGstar,
      E23: c.jackpot, C24: c.comision, E25: c.hipodromo,
      C26: c.totalOperador, E26: c.totalGstar,
      C29: c.totalPagarOperador, E29: c.totalPagarGstar
    };
  }

  return { PARAMS_DEFAULT, calcular, aCeldas };
})();
window.Calculo = Calculo;
