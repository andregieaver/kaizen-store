<?php
/**
 * What the cart in the browser asks this site: the lines' live prices, and the hand-over of the cart to the store's checkout. The site's
 * server asks Kaizen with the connection's token, which the browser never sees. Anyone may ask (a visitor has no account), so the calls
 * are limited: only stores a saved view shows, a short list of well-formed lines, and a few calls a minute from one address.
 *
 * @package KaizenStore
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Kaizen_Store_Rest {

	const NAMESPACE_ = 'kaizen/v1';

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
	}

	public static function routes() {
		foreach ( array( 'quote', 'checkout' ) as $name ) {
			register_rest_route(
				self::NAMESPACE_,
				'/cart/' . $name,
				array(
					'methods'             => 'POST',
					'callback'            => array( __CLASS__, $name ),
					'permission_callback' => '__return_true',
				)
			);
		}
	}

	/**
	 * The lines of a request, or an error: each a variant (a UUID) and a quantity from 1 to 20, at most 30 lines.
	 *
	 * @param array $body Request body.
	 * @return array|WP_Error { store, market, lines }
	 */
	public static function read( $body ) {
		$bad    = new WP_Error( 'kaizen_invalid_cart', __( 'That cart could not be read.', 'kaizen-store' ), array( 'status' => 400 ) );
		$store  = isset( $body['store'] ) && is_string( $body['store'] ) ? $body['store'] : '';
		$market = isset( $body['market'] ) && is_string( $body['market'] ) ? $body['market'] : '';
		$lines  = isset( $body['lines'] ) && is_array( $body['lines'] ) ? $body['lines'] : array();
		if ( ! preg_match( '/^[a-z0-9-]{3,40}$/', $store ) || ( '' !== $market && ! preg_match( '/^[a-z0-9-]{2,40}$/', $market ) ) || empty( $lines ) || count( $lines ) > 30 ) {
			return $bad;
		}
		if ( ! in_array( $store, Kaizen_Store_Views::stores_in_use(), true ) ) {
			return new WP_Error( 'kaizen_no_such_store', __( 'No such store.', 'kaizen-store' ), array( 'status' => 404 ) );
		}
		$clean = array();
		$seen  = array();
		foreach ( $lines as $line ) {
			$variant  = is_array( $line ) && isset( $line['variant_id'] ) && is_string( $line['variant_id'] ) ? strtolower( $line['variant_id'] ) : '';
			$quantity = is_array( $line ) && isset( $line['quantity'] ) && is_numeric( $line['quantity'] ) ? (int) $line['quantity'] : 0;
			if ( ! preg_match( Kaizen_Store_Views::UUID, $variant ) || $quantity < 1 || $quantity > 20 || isset( $seen[ $variant ] ) ) {
				return $bad;
			}
			$seen[ $variant ] = true;
			$clean[]          = array(
				'variant_id' => $variant,
				'quantity'   => $quantity,
			);
		}
		return array(
			'store'  => $store,
			'market' => $market,
			'lines'  => $clean,
		);
	}

	/**
	 * Lets one address make so many calls in a minute.
	 *
	 * @param string $bucket Name of the kind of call.
	 * @param int    $limit  Calls a minute.
	 * @return bool
	 */
	private static function allowed( $bucket, $limit ) {
		$address = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : 'unknown';
		$key     = 'kaizen_store_rl_' . $bucket . '_' . md5( $address . '|' . (int) floor( time() / 60 ) );
		$count   = (int) get_transient( $key ) + 1;
		set_transient( $key, $count, 2 * MINUTE_IN_SECONDS );
		return $count <= $limit;
	}

	private static function error( $error ) {
		$data   = $error->get_error_data();
		$status = is_array( $data ) && isset( $data['status'] ) ? (int) $data['status'] : 502;
		if ( 401 === $status ) {
			$status = 503; // The site's own connection is the owner's to mend; the visitor has nothing to do with it.
		}
		return new WP_REST_Response( array( 'error' => array( 'code' => $error->get_error_code(), 'message' => $error->get_error_message() ) ), $status );
	}

	public static function quote( $request ) {
		$read = self::read( (array) $request->get_json_params() );
		if ( is_wp_error( $read ) ) {
			return self::error( $read );
		}
		if ( ! self::allowed( 'quote', 90 ) ) {
			return new WP_REST_Response( array( 'error' => array( 'code' => 'rate_limited', 'message' => __( 'Too many requests. Try again in a moment.', 'kaizen-store' ) ) ), 429 );
		}
		$key    = 'kaizen_store_q_' . md5( wp_json_encode( $read ) );
		$cached = get_transient( $key );
		if ( is_array( $cached ) ) {
			return new WP_REST_Response( $cached, 200 );
		}
		$answer = Kaizen_Store_Api::quote( $read['store'], $read['market'], $read['lines'] );
		if ( is_wp_error( $answer ) ) {
			return self::error( $answer );
		}
		set_transient( $key, $answer, 15 );
		return new WP_REST_Response( $answer, 200 );
	}

	public static function checkout( $request ) {
		$body = (array) $request->get_json_params();
		$read = self::read( $body );
		if ( is_wp_error( $read ) ) {
			return self::error( $read );
		}
		if ( ! self::allowed( 'checkout', 12 ) ) {
			return new WP_REST_Response( array( 'error' => array( 'code' => 'rate_limited', 'message' => __( 'Too many requests. Try again in a moment.', 'kaizen-store' ) ) ), 429 );
		}
		$to     = isset( $body['to'] ) && 'cart' === $body['to'] ? 'cart' : 'checkout';
		$answer = Kaizen_Store_Api::handoff( $read['store'], $read['market'], $read['lines'], $to );
		if ( is_wp_error( $answer ) ) {
			return self::error( $answer );
		}
		return new WP_REST_Response( $answer, 200 );
	}
}
