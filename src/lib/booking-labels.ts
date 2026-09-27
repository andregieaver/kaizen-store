import type { AppointmentPickerLabels } from "@/components/appointment-picker";
import type { BookingChangesLabels } from "@/components/booking-changes";

import type { Messages } from "./i18n";

/** The time picker's texts (D65), on the product page and when moving a booking. */
export function pickerLabels(m: Messages): AppointmentPickerLabels {
  return {
    addToCart: m.addToCart,
    adding: m.adding,
    added: m.added,
    capped: m.capped,
    unavailable: m.unavailable,
    planConflict: m.planConflict,
    tryAgain: m.tryAgain,
    goToCart: m.goToCart,
    chooseTime: m.booking.chooseTime,
    who: m.booking.who,
    anyone: m.booking.anyone,
    earlier: m.booking.earlier,
    later: m.booking.later,
    noTimes: m.booking.noTimes,
    noTimesDay: m.booking.noTimesDay,
    choose: m.booking.choose,
    slotTaken: m.booking.slotTaken,
    loading: m.booking.loading,
    option: m.booking.option,
  };
}

/** The texts for changing one's own booking (D66): until when, and what cancelling pays back. */
export function bookingChangesLabels(m: Messages, until: string, refund: string | null): BookingChangesLabels {
  return {
    ...pickerLabels(m),
    changeTime: m.booking.changeTime,
    cancelBooking: m.booking.cancelBooking,
    confirmCancel: m.booking.confirmCancel,
    keepBooking: m.booking.keepBooking,
    changeUntil: m.booking.changeUntil(until),
    changeClosed: m.booking.changeClosed,
    moved: m.booking.moved,
    cancelled: m.booking.cancelled,
    moveTo: m.booking.moveTo,
    refundNote: refund ? m.booking.refundNote(refund) : null,
  };
}
