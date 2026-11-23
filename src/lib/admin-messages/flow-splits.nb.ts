import type { FlowSplitsMessages } from "./flow-splits.en";

/** Et forløps splittester (M2.5, D868), på norsk bokmål, skrevet for hånd. */
export const flowSplitsNb: FlowSplitsMessages = {
  title: "Splittester, de siste 30 dagene",
  ways: "Første vei: {pa} personer, {oa} bestillinger. Andre vei: {pb} personer, {ob} bestillinger.",
  calls: {
    better: "Den {way} veien gir tydelig flere bestillinger per person.",
    even: "Ingen tydelig forskjell ennå.",
    few: "For få personer ennå: hver vei trenger {floor} for å skille dem.",
    broken: "De to veiene ble ujevne, så testen kan ikke leses.",
  },
  first: "første",
  second: "andre",
  keep: "Behold den {way} veien",
  kept: "Beholdt. Forløpet er av til du tester det igjen.",
};
