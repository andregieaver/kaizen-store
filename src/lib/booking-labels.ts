import type { AppointmentPickerLabels } from "@/components/appointment-picker";
import type { BookingChangesLabels } from "@/components/booking-changes";
import type { RangePickerLabels } from "@/components/range-picker";

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

/** The date picker's texts for a stay or a rental (D67), with its shortest and longest. */
export function rangePickerLabels(m: Messages, stay: boolean, minNights: number, maxNights: number): RangePickerLabels {
  return {
    addToCart: m.addToCart,
    adding: m.adding,
    added: m.added,
    capped: m.capped,
    unavailable: m.unavailable,
    planConflict: m.planConflict,
    tryAgain: m.tryAgain,
    goToCart: m.goToCart,
    chooseDates: m.stay.chooseDates,
    pickStart: stay ? m.stay.pickArrival : m.stay.pickFirst,
    pickEnd: stay ? m.stay.pickDeparture : m.stay.pickLast,
    start: stay ? m.stay.arrival : m.stay.first,
    end: stay ? m.stay.departure : m.stay.last,
    earlier: m.stay.earlier,
    later: m.stay.later,
    taken: m.stay.taken,
    free: m.stay.free,
    full: m.stay.full,
    clear: m.stay.clear,
    loading: m.booking.loading,
    option: m.booking.option,
    lengthOne: stay ? m.stay.nights(1) : m.stay.days(1),
    lengthMany: stay ? m.stay.nights(2).replace("2", "#") : m.stay.days(2).replace("2", "#"),
    tooShort: m.stay.tooShort(minNights, stay),
    tooLong: m.stay.tooLong(maxNights, stay),
    pickDay: m.stay.pickDay,
    pickTime: m.stay.pickTime,
    chooseTime: m.stay.chooseTime,
    howLong: m.stay.howLong,
    noTimes: m.stay.noTimes,
    hourOne: m.stay.hours(1),
    hourMany: m.stay.hours(2).replace("2", "#"),
    total: m.total,
    feeIncluded: m.stay.feeIncluded(stay),
    vatIncluded: m.vatIncluded,
    vatExcluded: m.vatExcluded,
  };
}
