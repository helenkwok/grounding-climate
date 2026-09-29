use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;

use boring::asn1::Asn1Time;
use boring::bn::BigNum;
use boring::hash::MessageDigest;
use boring::pkey::{PKey, Private};
use boring::rsa::Rsa;
use boring::ssl::{
    SslAcceptor, SslConnector, SslMethod, SslVerifyMode, SslVersion,
};
use boring::x509::{X509NameBuilder, X509};

fn self_signed_certificate() -> (X509, PKey<Private>) {
    let rsa = Rsa::generate(2048).unwrap();
    let private_key = PKey::from_rsa(rsa).unwrap();

    let mut name = X509NameBuilder::new().unwrap();
    name.append_entry_by_text("CN", "localhost").unwrap();
    let name = name.build();

    let mut certificate = X509::builder().unwrap();
    certificate.set_version(2).unwrap();

    let serial = BigNum::from_u32(1)
        .unwrap()
        .to_asn1_integer()
        .unwrap();
    certificate.set_serial_number(&serial).unwrap();
    certificate.set_subject_name(&name).unwrap();
    certificate.set_issuer_name(&name).unwrap();
    certificate.set_pubkey(&private_key).unwrap();

    let not_before = Asn1Time::days_from_now(0).unwrap();
    let not_after = Asn1Time::days_from_now(1).unwrap();
    certificate.set_not_before(&not_before).unwrap();
    certificate.set_not_after(&not_after).unwrap();
    certificate
        .sign(&private_key, MessageDigest::sha256())
        .unwrap();

    (certificate.build(), private_key)
}

#[test]
fn negotiates_x25519_mlkem768_locally() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();

    let server = thread::spawn(move || {
        let (certificate, private_key) = self_signed_certificate();

        let mut acceptor =
            SslAcceptor::mozilla_intermediate_v5(SslMethod::tls()).unwrap();
        acceptor.set_private_key(&private_key).unwrap();
        acceptor.set_certificate(&certificate).unwrap();
        acceptor.check_private_key().unwrap();
        acceptor
            .set_min_proto_version(Some(SslVersion::TLS1_3))
            .unwrap();
        acceptor
            .set_max_proto_version(Some(SslVersion::TLS1_3))
            .unwrap();
        acceptor
            .set_curves_list("X25519MLKEM768")
            .unwrap();
        let acceptor = acceptor.build();

        let tcp = listener.accept().unwrap().0;
        let mut tls = acceptor.accept(tcp).unwrap();
        let group_id = tls
            .ssl()
            .curve()
            .expect("server negotiated no key-exchange group");

        tls.write_all(b"P").unwrap();
        group_id
    });

    let mut connector = SslConnector::builder(SslMethod::tls()).unwrap();
    connector.set_verify(SslVerifyMode::NONE);
    connector
        .set_min_proto_version(Some(SslVersion::TLS1_3))
        .unwrap();
    connector
        .set_max_proto_version(Some(SslVersion::TLS1_3))
        .unwrap();
    connector
        .set_curves_list("X25519MLKEM768")
        .unwrap();
    let connector = connector.build();

    let tcp = TcpStream::connect(address).unwrap();
    let mut tls = connector.connect("localhost", tcp).unwrap();
    let client_group_id = tls
        .ssl()
        .curve()
        .expect("client negotiated no key-exchange group");

    let mut byte = [0_u8; 1];
    tls.read_exact(&mut byte).unwrap();

    let server_group_id = server.join().unwrap();

    // BoringSSL defines SSL_GROUP_X25519_MLKEM768 as 0x11ec.
    // boring 5.2.0 exposes the negotiated group through SslRef::curve();
    // curve_name() may return None for hybrid groups even when negotiation
    // succeeds, so assert the wire group ID directly.
    const X25519_MLKEM768_GROUP_ID: u16 = 0x11ec;

    assert_eq!(byte, [b'P']);
    assert_eq!(client_group_id, X25519_MLKEM768_GROUP_ID);
    assert_eq!(server_group_id, X25519_MLKEM768_GROUP_ID);
}
