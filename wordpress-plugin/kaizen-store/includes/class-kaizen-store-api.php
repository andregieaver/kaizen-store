<?php
/**
 * Kaizen Store's plugin API (version 1), read with the connection's token. Every call returns the decoded answer or a WP_Error.
 *
 * @package KaizenStore
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Kaizen_Store_Api {

	/**
	 * One call.
	 *
	 * @param string     $method GET, POST or DELETE.
	 * @param string     $path   Path after /api/wordpress/v1.
	 * @param array      $query  Query arguments.
	 * @param array|null $body   JSON body.
	 * @param bool       $auth   Whether to send the token.
	 * @return array|WP_Error
	 */
	public static function request( $method, $path, $query = array(), $body = null, $auth = true ) {
		$url = Kaizen_Store_Settings::api_url() . '/api/wordpress/v1' . $path;
		if ( ! empty( $query ) ) {
			$url = add_query_arg( array_map( 'strval', $query ), $url );
		}
		$headers = array(
			'Accept'     => 'application/json',
			'User-Agent' => 'KaizenStoreWordPress/' . KAIZEN_STORE_VERSION . '; ' . home_url(),
		);
		if ( $auth ) {
			$token = Kaizen_Store_Settings::token();
			if ( '' === $token ) {
				return new WP_Error( 'kaizen_not_connected', __( 'This site is not connected to Kaizen Store.', 'kaizen-store' ) );
			}
			$headers['Authorization'] = 'Bearer ' . $token;
		}
		$args = array(
			'method'  => $method,
			'timeout' => 15,
			'headers' => $headers,
		);
		if ( null !== $body ) {
			$args['headers']['Content-Type'] = 'application/json';
			$args['body']                    = wp_json_encode( $body );
		}
		$response = wp_remote_request( $url, $args );
		if ( is_wp_error( $response ) ) {
			return new WP_Error( 'kaizen_unreachable', __( 'Kaizen Store could not be reached. Try again in a moment.', 'kaizen-store' ) );
		}
		$status  = (int) wp_remote_retrieve_response_code( $response );
		$decoded = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( $status >= 200 && $status < 300 && is_array( $decoded ) ) {
			return $decoded;
		}
		$code    = 'kaizen_error';
		$message = __( 'Kaizen Store could not answer. Try again in a moment.', 'kaizen-store' );
		if ( is_array( $decoded ) && isset( $decoded['error']['code'] ) ) {
			$code    = 'kaizen_' . sanitize_key( $decoded['error']['code'] );
			$message = isset( $decoded['error']['message'] ) ? sanitize_text_field( $decoded['error']['message'] ) : $message;
		}
		return new WP_Error( $code, $message, array( 'status' => $status ) );
	}

	public static function exchange( $code, $verifier, $site ) {
		return self::request(
			'POST',
			'/token',
			array(),
			array(
				'code'     => $code,
				'verifier' => $verifier,
				'site'     => $site,
			),
			false
		);
	}

	public static function connection() {
		return self::request( 'GET', '/connection' );
	}

	public static function disconnect() {
		return self::request( 'DELETE', '/connection' );
	}

	public static function stores() {
		return self::request( 'GET', '/stores' );
	}

	public static function terms( $store ) {
		return self::request( 'GET', '/stores/' . rawurlencode( $store ) . '/terms' );
	}

	public static function products( $store, $search = '' ) {
		return self::request( 'GET', '/stores/' . rawurlencode( $store ) . '/products', array( 'q' => $search, 'limit' => 30 ) );
	}

	public static function product( $store, $market, $handle ) {
		return self::request( 'GET', '/stores/' . rawurlencode( $store ) . '/product', array( 'handle' => $handle, 'market' => $market ) );
	}

	public static function quote( $store, $market, $lines ) {
		return self::request( 'POST', '/stores/' . rawurlencode( $store ) . '/cart/quote', array(), array( 'market' => $market, 'lines' => $lines ) );
	}

	public static function handoff( $store, $market, $lines, $to = 'checkout' ) {
		return self::request( 'POST', '/stores/' . rawurlencode( $store ) . '/cart/handoff', array(), array( 'market' => $market, 'lines' => $lines, 'to' => $to ) );
	}

	public static function view( $store, $query ) {
		return self::request( 'GET', '/stores/' . rawurlencode( $store ) . '/view', $query );
	}

	/**
	 * Whether an error means the token is no longer good, so the site must be connected again.
	 *
	 * @param WP_Error $error Error from a call.
	 * @return bool
	 */
	public static function is_unauthorized( $error ) {
		if ( ! is_wp_error( $error ) ) {
			return false;
		}
		$data = $error->get_error_data();
		return is_array( $data ) && isset( $data['status'] ) && 401 === (int) $data['status'];
	}
}
