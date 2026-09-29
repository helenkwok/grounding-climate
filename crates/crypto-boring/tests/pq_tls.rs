use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;

use boring::asn1::Asn1Time;
use boring::bn::BigNum;
use boring::hash::MessageDigest;
use boring::pkey::{PKey, Private};
use boring::rsa::Rsa;
use boring::ssl::{
    SslAcceptor, SslConnector, SslMethod, SslVerifyMode,
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
            SslAcceptor::mozilla_intermediate(SslMethod::tls()).unwrap();
        acceptor.set_private_key(&private_key).unwrap();
        acceptor.set_certificate(&certificate).unwrap();
        acceptor.check_private_key().unwrap();
        acceptor
            .set_curves_list("X25519MLKEM768")
            .unwrap();
        let acceptor = acceptor.build();

        let tcp = listener.accept().unwrap().0;
        let mut tls = acceptor.accept(tcp).unwrap();
        let curve = tls
            .ssl()
            .curve_name()
            .expect("server negotiated no key-exchange group")
            .to_owned();

        tls.write_all(b"P").unwrap();
        curve
    });

    let mut connector = SslConnector::builder(SslMethod::tls()).unwrap();
    connector.set_verify(SslVerifyMode::NONE);
    connector
        .set_curves_list("X25519MLKEM768")
        .unwrap();
    let connector = connector.build();

    let tcp = TcpStream::connect(address).unwrap();
    let mut tls = connector.connect("localhost", tcp).unwrap();
    let client_curve = tls
        .ssl()
        .curve_name()
        .expect("client negotiated no key-exchange group")
        .to_owned();

    let mut byte = [0_u8; 1];
    tls.read_exact(&mut byte).unwrap();

    let server_curve = server.join().unwrap();

    assert_eq!(byte, [b'P']);
    assert_eq!(client_curve, "X25519MLKEM768");
    assert_eq!(server_curve, "X25519MLKEM768");
}
