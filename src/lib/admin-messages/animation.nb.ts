import type { AnimationMessages } from "./animation.en";

/** Sidebyggerens ord for komponenten Animasjon, på bokmål (D538, D312), skrevet for hånd. */
export const animationNb: AnimationMessages = {
  none: "Ingen animasjon ennå",
  upload: "Last opp en animasjon",
  another: "Velg en annen animasjon",
  hint: "En WebM-video med gjennomsiktig bakgrunn, opptil 20 sekunder, uten lyd. Nettleseren din gjør den klar, så den spilles overalt, også på iPhone.",
  preparing: "Gjør klar … {percent} %",
  fileName: "{name} (animasjon: bilde og maske)",
  ownSize: "Vises i høyst {width} × {height} piksler.",
  description: "Beskrivelse",
  descriptionHint: "Hva den viser, for folk som bruker skjermleser. Den leses mens animasjonen spilles og etterpå.",
  logo: "Animert logo",
  logoHint: "Spilles én gang når en besøkende kommer, her, og blir så stående som logoen. Den tegnes like høy som logoen, så la utsnittet ligge tett rundt selve logoen. Uten en vises nettstedets logo.",
  loop: "Spill om og om igjen",
  loopHint: "Av: den spilles én gang når den kommer til syne, og blir stående på siste bilde. Besøkende som foretrekker mindre bevegelse ser det siste bildet.",
  refusals: {
    type: "Bruk en WebM-video: formatet med gjennomsiktig bakgrunn som nettlesere kan lese. De fleste animasjonsprogrammer eksporterer det.",
    size: "Filen er for stor. Bruk en som er under 200 MB.",
    opaque: "Videoen har ingen gjennomsiktig bakgrunn, så den ville bli spilt i en boks. Bruk komponenten Video til den.",
    long: "En animasjon er høyst 20 sekunder. Bruk komponenten Video til en lengre film.",
    small: "Videoen er for liten til å vises.",
    browser: "Denne nettleseren kan ikke gjøre en animasjon klar. Bruk Chrome eller Edge på en datamaskin eller en Android-telefon.",
    unreadable: "Filen kunne ikke leses som en video.",
  },
};
