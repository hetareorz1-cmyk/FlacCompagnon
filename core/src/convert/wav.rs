//! WAV encoding via `hound` — the same crate this crate's own tests already
//! use to synthesize fixtures (see e.g. `tags::mod::tests::synth_wav`), so
//! the call shape here follows an already-proven pattern rather than a fresh
//! guess at the API.
//!
//! Fixed at 16-bit PCM: unlike FLAC, WAV has no lossless-at-any-depth
//! encoder API to lean on here, and 16-bit keeps `hound`'s typed
//! `write_sample::<i16>` call unambiguous. This isn't a hi-res archival
//! format in this app's conversion panel — it exists as a guaranteed-honest
//! PCM copy of a file this app may have flagged as fake-lossless, and 16-bit
//! already exceeds what a genuinely lossy source ever contained.

use std::path::Path;

use super::ConvertError;
use crate::decode::PcmAudio;

const BIT_DEPTH: u32 = 16;

/// Encode `pcm` as 16-bit PCM WAV to `dest`.
pub(super) fn encode(pcm: &PcmAudio, dest: &Path) -> Result<(), ConvertError> {
    let name = || dest.display().to_string();
    let spec = hound::WavSpec {
        channels: pcm.channels as u16,
        sample_rate: pcm.sample_rate,
        bits_per_sample: BIT_DEPTH as u16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer =
        hound::WavWriter::create(dest, spec).map_err(|e| ConvertError::Encode(name(), e.to_string()))?;

    let ints = super::f32_to_ints(&pcm.samples, BIT_DEPTH);
    for s in ints {
        writer
            .write_sample(s as i16)
            .map_err(|e| ConvertError::Encode(name(), e.to_string()))?;
    }
    writer
        .finalize()
        .map_err(|e| ConvertError::Encode(name(), e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// PCM WAV is trivially lossless at a fixed depth: what goes in as an
    /// integer must come back as the exact same integer. `hound` reads its
    /// own files back here — a second, independent decode isn't needed the
    /// way it is for FLAC's compressed bitstream, since there is no
    /// bitstream format to get subtly wrong, only a fixed-width sample
    /// layout `hound` itself defines on both ends.
    #[test]
    fn round_trips_exactly_at_16_bit() {
        let samples = vec![-1.0f32, -0.5, 0.0, 0.25, 0.5, 1.0, -1.0, 0.5];
        let pcm = PcmAudio {
            samples: samples.clone(),
            sample_rate: 44_100,
            channels: 2,
        };
        let dir = tempfile::tempdir().expect("tempdir");
        let dest = dir.path().join("tone.wav");
        encode(&pcm, &dest).expect("encode");

        let mut reader = hound::WavReader::open(&dest).expect("reopen");
        let decoded: Vec<i32> = reader
            .samples::<i16>()
            .map(|s| s.expect("decode") as i32)
            .collect();
        assert_eq!(decoded, super::super::f32_to_ints(&samples, BIT_DEPTH));
    }

    /// A malformed destination (a parent folder that doesn't exist) must
    /// come back as a named [`ConvertError`], not a panic — `convert_file`
    /// creates the parent first in the normal path, but this module's own
    /// `encode` doesn't assume it always will.
    #[test]
    fn missing_parent_folder_is_a_named_error_not_a_panic() {
        let pcm = PcmAudio {
            samples: vec![0.0, 0.0],
            sample_rate: 44_100,
            channels: 2,
        };
        let dest = Path::new("/definitely/not/a/real/folder/track.wav");
        assert!(encode(&pcm, dest).is_err());
    }
}
