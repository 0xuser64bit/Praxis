use anchor_lang::{
    error::{Error, ErrorCode},
    prelude::{AccountInfo, Program, Pubkey, System},
    system_program,
};

#[test]
fn system_program_rejects_another_executable() {
    let substitute = aegis::ID;
    let owner = Pubkey::new_unique();
    let mut lamports = 1;
    let mut data = [];
    let account = AccountInfo::new(
        &substitute,
        false,
        false,
        &mut lamports,
        &mut data,
        &owner,
        true,
    );

    let result = Program::<System>::try_from(&account);
    let Err(Error::AnchorError(error)) = result else {
        panic!("System program validation must reject an executable with another address");
    };
    assert_eq!(error.error_code_number, ErrorCode::InvalidProgramId as u32);
}

#[test]
fn system_program_accepts_only_the_executable_system_program() {
    for executable in [true, false] {
        let address = system_program::ID;
        let owner = Pubkey::new_unique();
        let mut lamports = 1;
        let mut data = [];
        let account = AccountInfo::new(
            &address,
            false,
            false,
            &mut lamports,
            &mut data,
            &owner,
            executable,
        );

        assert_eq!(Program::<System>::try_from(&account).is_ok(), executable);
    }
}
