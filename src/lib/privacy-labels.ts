/** Plain words only: these cross from the server page to this client component, so no function (the texts with a number in them) may. */
export type StepUpLabels = {
  heading: string;
  text: string;
  sendCode: string;
  codeLabel: string;
  passwordLabel: string;
  confirm: string;
};
export type DeleteLabels = { irreversible: string; confirmButton: string; backLink: string };

export const stepUpLabels = (text: { stepUpHeading: string; stepUpText: string; stepUpSendCode: string; stepUpCodeLabel: string; stepUpPasswordLabel: string; stepUpConfirm: string }): StepUpLabels => ({
  heading: text.stepUpHeading,
  text: text.stepUpText,
  sendCode: text.stepUpSendCode,
  codeLabel: text.stepUpCodeLabel,
  passwordLabel: text.stepUpPasswordLabel,
  confirm: text.stepUpConfirm,
});
export const deleteLabels = (text: { irreversible: string; confirmButton: string; backLink: string }): DeleteLabels => ({
  irreversible: text.irreversible,
  confirmButton: text.confirmButton,
  backLink: text.backLink,
});

